export type TaskStatus = "pending" | "in_progress" | "blocked" | "completed";
export type PackStatus = "no_tasks" | "pending" | "in_progress" | "blocked" | "completed";
export type GitRefresh = "auto" | "always" | "never";
export type PackInputType = "string" | "enum" | "boolean" | "number";
export type PackInputValue = string | number | boolean;
export type InputSource = "cli" | "default" | "set";
export type TaskActivation = "active" | "locked";
export type PackAgentRunStatus = "completed" | "failed" | "timed_out" | "signaled";
export type PackAgentRunMode = "captured" | "interactive";
export type TaskWhen = string | Record<string, TaskWhenCondition>;
export type TaskWhenCondition =
  | string
  | number
  | boolean
  | null
  | { in: Array<string | number | boolean> };

export type SourceInfo =
  | FileSourceInfo
  | DirectorySourceInfo
  | GlobSourceInfo
  | GitSourceInfo
  | UrlSourceInfo;

export interface FileSourceInfo {
  kind: "file";
  path: string;
}

export interface DirectorySourceInfo {
  kind: "directory";
  path: string;
}

export interface GlobSourceInfo {
  kind: "glob";
  path: string;
}

export interface GitSourceInfo {
  kind: "git";
  url: string;
  requestedRef?: string;
  resolvedRef: string;
  resolvedCommit: string;
  repoHash: string;
  path?: string;
}

export interface UrlSourceInfo {
  kind: "url";
  url: string;
}

export interface PackTask {
  id: string;
  sourceId?: string;
  title: string;
  category?: string;
  body?: string;
  doneWhen?: string[];
  status: TaskStatus;
  notes: string[];
  source?: SourceInfo;
  activation?: TaskActivation;
  when?: TaskWhen;
  unlockedAt?: string;
  startedAt?: string;
  completedAt?: string;
  blockedAt?: string;
}

export interface PackReference {
  id: string;
  name: string;
  description?: string;
  source: SourceInfo;
  path?: string;
  rootPath?: string;
  files?: string[];
}

export interface PackSkill {
  id: string;
  name: string;
  description?: string;
  source: SourceInfo;
  path: string;
}

export interface PackAgent {
  name: string;
  command: string;
  args: string[];
  timeoutSec?: number;
  maxAttempts?: number;
  source?: SourceInfo;
}

export interface PackAgentRun {
  id: string;
  agent: string;
  attempt?: number;
  mode: PackAgentRunMode;
  status: PackAgentRunStatus;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
  stdout: string;
  stdoutTruncated: boolean;
}

export interface TaskCounts {
  total: number;
  pending: number;
  inProgress: number;
  completed: number;
  blocked: number;
}

export interface PackContract {
  do?: string[];
  dont?: string[];
}

export interface PackInputDef {
  type: PackInputType;
  required: boolean;
  description?: string;
  default?: PackInputValue;
  values?: string[];
}

export interface InputSourceInfo {
  source: InputSource;
}

export interface PackState {
  schemaVersion: 1;
  id: string;
  name?: string;
  status: PackStatus;
  createdAt: string;
  updatedAt: string;
  repoRoot: string;
  prompt?: string;
  instructions?: string;
  taskCounts: TaskCounts;
  inputSchema?: Record<string, PackInputDef>;
  inputs?: Record<string, PackInputValue>;
  inputSources?: Record<string, InputSourceInfo>;
  tasks: PackTask[];
  references: PackReference[];
  skills: PackSkill[];
  agents?: PackAgent[];
  agentRuns?: PackAgentRun[];
  contract?: PackContract;
}

export interface ManifestInputDef {
  type?: PackInputType;
  required?: boolean;
  description?: string;
  default?: unknown;
  values?: unknown[];
}

export interface ManifestTask {
  id?: string;
  title?: string;
  category?: string;
  body?: string;
  doneWhen?: string[];
  when?: TaskWhen;
  source?: SourceInfo;
}

export interface ManifestReference {
  name?: string;
  description?: string;
  ref: string;
}

export interface ManifestSkill {
  name?: string;
  description?: string;
  ref: string;
}

export interface ManifestAgent {
  name: string;
  command: string;
  args?: string[];
  timeoutSec?: number;
  maxAttempts?: number;
}

export interface PackManifest {
  schemaVersion?: number;
  name?: string;
  instructions?: string;
  inputs?: Record<string, ManifestInputDef>;
  tasks?: Array<ManifestTask | string>;
  references?: Array<ManifestReference | string>;
  skills?: Array<ManifestSkill | string>;
  agents?: Array<ManifestAgent | string>;
  contract?: PackContract;
}

export type InitInclude =
  | { type: "manifest"; ref: string }
  | { type: "instructions"; path: string }
  | { type: "taskRef"; ref: string }
  | { type: "adHocTask"; text: string }
  | { type: "reference"; ref: ManifestReference }
  | { type: "skill"; ref: ManifestSkill }
  | { type: "agentRef"; ref: string };

export interface InitInput {
  createId?: string;
  name?: string;
  includes: InitInclude[];
  inputAssignments?: string[];
  prompt?: string;
  stateDir?: string;
  gitRefresh: GitRefresh;
  json?: boolean;
}

export interface RuntimePaths {
  cwd: string;
  repoRoot: string;
  configDir: string;
  stateDir: string;
  cacheDir: string;
  gitCacheDir: string;
  packDir: string;
  eventDir: string;
  lockDir: string;
  indexPath: string;
}

export type SystemStatus = RuntimePaths & {
  defaultPackId?: string;
  defaultCreateId?: string;
};

export interface CleanResult {
  packIds: string[];
  repoHashes: string[];
  removed: string[];
}

export type CatalogType = "manifest" | "task" | "reference" | "skill" | "agent";

export interface CatalogEntry {
  type: CatalogType;
  name: string;
  path: string;
}
