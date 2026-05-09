import { AgentPackError } from "./errors.js";
import type {
  InputSource,
  ManifestInputDef,
  PackInputDef,
  PackInputValue,
  PackState,
  PackTask,
  TaskWhen,
  TaskWhenCondition,
} from "./types.js";

const inputTypes = new Set(["string", "enum", "boolean", "number"]);
const inputNamePattern = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const inputDefinitionFields = new Set(["type", "required", "description", "default", "values"]);

export interface ResolvedInputs {
  inputSchema?: Record<string, PackInputDef>;
  inputs?: Record<string, PackInputValue>;
  inputSources?: Record<string, { source: InputSource }>;
}

export interface InputEntry {
  name: string;
  value?: PackInputValue;
  required: boolean;
  type: PackInputDef["type"];
  values?: string[];
  source?: InputSource;
  description?: string;
}

export function activeTasks(tasks: PackTask[]): PackTask[] {
  return tasks.filter((task) => task.activation !== "locked");
}

export function lockedTasks(tasks: PackTask[]): PackTask[] {
  return tasks.filter((task) => task.activation === "locked");
}

export function resolveInitInputs(
  schemas: Array<Record<string, ManifestInputDef> | undefined>,
  assignments: string[] = [],
): ResolvedInputs {
  const inputSchema = mergeInputSchemas(schemas);
  const hasSchema = Object.keys(inputSchema).length > 0;
  const parsedAssignments = parseInputAssignments(assignments, inputSchema);
  const inputs: Record<string, PackInputValue> = {};
  const inputSources: Record<string, { source: InputSource }> = {};

  for (const [name, definition] of Object.entries(inputSchema)) {
    const assigned = parsedAssignments.get(name);
    if (assigned) {
      inputs[name] = assigned.value;
      inputSources[name] = { source: "cli" };
      continue;
    }
    if (definition.default !== undefined) {
      inputs[name] = definition.default;
      inputSources[name] = { source: "default" };
      continue;
    }
    if (definition.required) {
      throw new AgentPackError(`missing required input: ${name}`);
    }
  }

  if (!hasSchema) {
    return {};
  }
  return {
    inputSchema,
    inputs: Object.keys(inputs).length ? inputs : undefined,
    inputSources: Object.keys(inputSources).length ? inputSources : undefined,
  };
}

export function initializeTaskActivation(
  tasks: PackTask[],
  inputSchema: Record<string, PackInputDef> | undefined,
  inputs: Record<string, PackInputValue> | undefined,
  now: string,
): void {
  for (const task of tasks) {
    if (task.when === undefined) {
      task.activation = "active";
      continue;
    }
    validateTaskWhen(task.when, inputSchema);
    if (taskWhenMatches(task.when, inputs ?? {})) {
      task.activation = "active";
      task.unlockedAt = now;
    } else {
      task.activation = "locked";
    }
  }
}

export function unlockSatisfiedTasks(pack: PackState, now: string): PackTask[] {
  const unlocked: PackTask[] = [];
  for (const task of pack.tasks) {
    if (task.activation !== "locked" || task.when === undefined) {
      continue;
    }
    validateTaskWhen(task.when, pack.inputSchema);
    if (taskWhenMatches(task.when, pack.inputs ?? {})) {
      task.activation = "active";
      task.unlockedAt = now;
      unlocked.push(task);
    }
  }
  return unlocked;
}

export function listInputEntries(pack: PackState): InputEntry[] {
  return Object.entries(pack.inputSchema ?? {}).map(([name, definition]) =>
    inputEntry(pack, name, definition),
  );
}

export function getInputEntry(pack: PackState, name: string): InputEntry {
  const definition = inputDefinition(pack, name);
  return inputEntry(pack, name, definition);
}

export function setInputValue(pack: PackState, name: string, rawValue: string): InputEntry {
  const definition = inputDefinition(pack, name);
  pack.inputs ??= {};
  pack.inputSources ??= {};
  pack.inputs[name] = coerceInputValue(name, definition, rawValue, "input");
  pack.inputSources[name] = { source: "set" };
  return inputEntry(pack, name, definition);
}

export function unsetInputValue(pack: PackState, name: string): InputEntry {
  const definition = inputDefinition(pack, name);
  if (definition.default !== undefined) {
    pack.inputs ??= {};
    pack.inputSources ??= {};
    pack.inputs[name] = definition.default;
    pack.inputSources[name] = { source: "default" };
    return inputEntry(pack, name, definition);
  }
  if (definition.required) {
    throw new AgentPackError(`required input cannot be unset: ${name}`);
  }
  delete pack.inputs?.[name];
  delete pack.inputSources?.[name];
  if (pack.inputs && Object.keys(pack.inputs).length === 0) {
    pack.inputs = undefined;
  }
  if (pack.inputSources && Object.keys(pack.inputSources).length === 0) {
    pack.inputSources = undefined;
  }
  return inputEntry(pack, name, definition);
}

export function inputKeyCandidates(pack: PackState): string[] {
  return Object.keys(pack.inputSchema ?? {});
}

export function inputValueCandidates(pack: PackState, name: string): string[] {
  const definition = pack.inputSchema?.[name];
  if (!definition) {
    return [];
  }
  if (definition.type === "enum") {
    return definition.values ?? [];
  }
  if (definition.type === "boolean") {
    return ["true", "false"];
  }
  return [];
}

export function validatePackInputs(pack: PackState, filePath: string): void {
  const schema = pack.inputSchema;
  if (schema === undefined) {
    rejectUnexpectedInputState(pack, "inputs", filePath);
    rejectUnexpectedInputState(pack, "inputSources", filePath);
    for (const task of pack.tasks) {
      if (task.when !== undefined) {
        throw new AgentPackError(`invalid pack task field 'when': ${filePath}`);
      }
    }
    return;
  }
  if (!isObject(schema)) {
    throw new AgentPackError(`invalid pack state field 'inputSchema': ${filePath}`);
  }

  for (const [name, definition] of Object.entries(schema)) {
    assertInputName(name, `input ${name}`);
    validateInputDefinition(name, definition);
  }

  if (pack.inputs !== undefined) {
    if (!isObject(pack.inputs)) {
      throw new AgentPackError(`invalid pack state field 'inputs': ${filePath}`);
    }
    for (const [name, value] of Object.entries(pack.inputs)) {
      const definition = schema[name];
      if (!definition) {
        throw new AgentPackError(`invalid pack input '${name}': ${filePath}`);
      }
      validatePersistedValue(name, definition, value, filePath);
    }
  }

  if (pack.inputSources !== undefined) {
    if (!isObject(pack.inputSources)) {
      throw new AgentPackError(`invalid pack state field 'inputSources': ${filePath}`);
    }
    for (const [name, value] of Object.entries(pack.inputSources)) {
      if (!schema[name] || !isObject(value)) {
        throw new AgentPackError(`invalid pack input source '${name}': ${filePath}`);
      }
      if (value.source !== "cli" && value.source !== "default" && value.source !== "set") {
        throw new AgentPackError(`invalid pack input source '${name}': ${filePath}`);
      }
    }
  }

  for (const [index, task] of pack.tasks.entries()) {
    if (task.when !== undefined) {
      try {
        validateTaskWhen(task.when, schema);
      } catch (error) {
        if (error instanceof AgentPackError) {
          throw new AgentPackError(`invalid pack task field 'tasks[${index}].when': ${filePath}`);
        }
        throw error;
      }
    }
  }
}

export function validateTaskActivation(task: PackTask, label: string, filePath: string): void {
  if (
    task.activation !== undefined &&
    task.activation !== "active" &&
    task.activation !== "locked"
  ) {
    throw new AgentPackError(`invalid pack task field '${label}.activation': ${filePath}`);
  }
  if (task.unlockedAt !== undefined && (typeof task.unlockedAt !== "string" || !task.unlockedAt)) {
    throw new AgentPackError(`invalid pack task field '${label}.unlockedAt': ${filePath}`);
  }
  if (task.activation === "locked") {
    if (task.status !== "pending") {
      throw new AgentPackError(`invalid pack task field '${label}.status': ${filePath}`);
    }
    if (task.startedAt || task.completedAt || task.blockedAt) {
      throw new AgentPackError(`invalid pack task lifecycle at '${label}': ${filePath}`);
    }
  }
}

function mergeInputSchemas(
  schemas: Array<Record<string, ManifestInputDef> | undefined>,
): Record<string, PackInputDef> {
  const merged: Record<string, PackInputDef> = {};
  for (const schema of schemas) {
    for (const [name, rawDefinition] of Object.entries(schema ?? {})) {
      const definition = normalizeInputDefinition(name, rawDefinition);
      const existing = merged[name];
      if (existing && JSON.stringify(existing) !== JSON.stringify(definition)) {
        throw new AgentPackError(`conflicting input definition: ${name}`);
      }
      merged[name] = definition;
    }
  }
  return merged;
}

function normalizeInputDefinition(name: string, raw: ManifestInputDef): PackInputDef {
  assertInputName(name, `input ${name}`);
  if (!isObject(raw)) {
    throw new AgentPackError(`input definition must be an object: ${name}`);
  }
  for (const field of Object.keys(raw)) {
    if (!inputDefinitionFields.has(field)) {
      throw new AgentPackError(`unsupported input definition field: ${name}.${field}`);
    }
  }
  const definition = raw as ManifestInputDef;
  const type = definition.type ?? "string";
  if (!inputTypes.has(type)) {
    throw new AgentPackError(`unsupported input type for ${name}: ${String(type)}`);
  }
  if (definition.required !== undefined && typeof definition.required !== "boolean") {
    throw new AgentPackError(`input ${name}.required must be a boolean`);
  }
  if (definition.description !== undefined) {
    requiredInputString(definition.description, `input ${name}.description`);
  }
  const normalized: PackInputDef = {
    type,
    required: definition.required ?? false,
    description: definition.description,
  };
  if (definition.values !== undefined) {
    if (
      !Array.isArray(definition.values) ||
      definition.values.length === 0 ||
      definition.values.some((value) => typeof value !== "string" || !value)
    ) {
      throw new AgentPackError(`input ${name}.values must be a non-empty array of strings`);
    }
    normalized.values = definition.values.map((value) => String(value));
  }
  if (type === "enum" && !normalized.values?.length) {
    throw new AgentPackError(`input ${name}.values is required for enum inputs`);
  }
  if (type !== "enum" && normalized.values !== undefined) {
    throw new AgentPackError(`input ${name}.values is only supported for enum inputs`);
  }
  if (definition.default !== undefined) {
    normalized.default = coerceInputValue(name, normalized, definition.default, "default");
  }
  return normalized;
}

function validateInputDefinition(name: string, definition: PackInputDef): void {
  normalizeInputDefinition(name, definition);
}

function parseInputAssignments(
  assignments: string[],
  schema: Record<string, PackInputDef>,
): Map<string, { value: PackInputValue }> {
  const parsed = new Map<string, { value: PackInputValue }>();
  for (const assignment of assignments) {
    const separator = assignment.indexOf("=");
    if (separator <= 0) {
      throw new AgentPackError(`input must be key=value: ${assignment}`);
    }
    const name = assignment.slice(0, separator);
    const rawValue = assignment.slice(separator + 1);
    const definition = schema[name];
    if (!definition) {
      throw new AgentPackError(`unknown input: ${name}`);
    }
    parsed.set(name, { value: coerceInputValue(name, definition, rawValue, "input") });
  }
  if (assignments.length > 0 && Object.keys(schema).length === 0) {
    throw new AgentPackError("unknown input: no inputs are declared");
  }
  return parsed;
}

function coerceInputValue(
  name: string,
  definition: PackInputDef,
  value: unknown,
  label: "default" | "input",
): PackInputValue {
  if (definition.type === "string") {
    if (typeof value !== "string") {
      throw new AgentPackError(`${label} ${name} must be a string`);
    }
    if (definition.required && !value.trim()) {
      throw new AgentPackError(`${label} ${name} must not be empty`);
    }
    return value;
  }
  if (definition.type === "enum") {
    if (typeof value !== "string" || !definition.values?.includes(value)) {
      throw new AgentPackError(
        `${label} ${name} must be one of: ${(definition.values ?? []).join(", ")}`,
      );
    }
    return value;
  }
  if (definition.type === "boolean") {
    if (typeof value === "boolean") {
      return value;
    }
    if (value === "true" || value === "1") {
      return true;
    }
    if (value === "false" || value === "0") {
      return false;
    }
    throw new AgentPackError(`${label} ${name} must be a boolean`);
  }
  if (definition.type === "number") {
    const numberValue = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numberValue)) {
      throw new AgentPackError(`${label} ${name} must be a finite number`);
    }
    return numberValue;
  }
  throw new AgentPackError(`unsupported input type for ${name}: ${definition.type}`);
}

function validatePersistedValue(
  name: string,
  definition: PackInputDef,
  value: unknown,
  filePath: string,
): void {
  try {
    coerceInputValue(name, definition, value, "input");
  } catch {
    throw new AgentPackError(`invalid pack input '${name}': ${filePath}`);
  }
}

function inputDefinition(pack: PackState, name: string): PackInputDef {
  const definition = pack.inputSchema?.[name];
  if (!definition) {
    throw new AgentPackError(`unknown input: ${name}`);
  }
  return definition;
}

function inputEntry(pack: PackState, name: string, definition: PackInputDef): InputEntry {
  return {
    name,
    value: pack.inputs?.[name],
    required: definition.required,
    type: definition.type,
    values: definition.values,
    source: pack.inputSources?.[name]?.source,
    description: definition.description,
  };
}

function validateTaskWhen(when: TaskWhen, schema: Record<string, PackInputDef> | undefined): void {
  const inputNames = new Set(Object.keys(schema ?? {}));
  if (typeof when === "string") {
    validateConditionInputName(when, inputNames);
    return;
  }
  if (!isObject(when)) {
    throw new AgentPackError("task when must be an input name or object");
  }
  for (const [name, condition] of Object.entries(when)) {
    validateConditionInputName(name, inputNames);
    validateWhenCondition(condition, name);
  }
}

function validateWhenCondition(condition: TaskWhenCondition | undefined, name: string): void {
  if (condition === null || condition === undefined) {
    return;
  }
  if (
    typeof condition === "string" ||
    typeof condition === "number" ||
    typeof condition === "boolean"
  ) {
    return;
  }
  if (!isObject(condition) || Object.keys(condition).length !== 1 || !Array.isArray(condition.in)) {
    throw new AgentPackError(`unsupported condition for input: ${name}`);
  }
  if (
    condition.in.length === 0 ||
    condition.in.some(
      (value) =>
        typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean",
    )
  ) {
    throw new AgentPackError(`condition ${name}.in must be a non-empty scalar array`);
  }
}

function validateConditionInputName(name: string, inputNames: Set<string>): void {
  assertInputName(name, `when ${name}`);
  if (!inputNames.has(name)) {
    throw new AgentPackError(`unknown input in task condition: ${name}`);
  }
}

function taskWhenMatches(when: TaskWhen, inputs: Record<string, PackInputValue>): boolean {
  if (typeof when === "string") {
    return inputExists(inputs[when]);
  }
  return Object.entries(when).every(([name, condition]) =>
    conditionMatches(inputs[name], condition),
  );
}

function conditionMatches(
  value: PackInputValue | undefined,
  condition: TaskWhenCondition | undefined,
): boolean {
  if (condition === null || condition === undefined) {
    return inputExists(value);
  }
  if (isObject(condition)) {
    return condition.in.some((candidate) => candidate === value);
  }
  return value === condition;
}

function inputExists(value: PackInputValue | undefined): boolean {
  return value !== undefined && (typeof value !== "string" || Boolean(value.trim()));
}

function rejectUnexpectedInputState(
  pack: PackState,
  field: "inputs" | "inputSources",
  filePath: string,
) {
  if (pack[field] !== undefined) {
    throw new AgentPackError(`invalid pack state field '${field}': ${filePath}`);
  }
}

function assertInputName(name: string, label: string): void {
  if (!inputNamePattern.test(name)) {
    throw new AgentPackError(`invalid ${label}`);
  }
}

function requiredInputString(value: unknown, label: string): void {
  if (typeof value !== "string" || !value.trim()) {
    throw new AgentPackError(`${label} must be a string`);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
