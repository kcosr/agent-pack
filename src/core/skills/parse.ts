import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import YAML from "yaml";
import { AgentPackError } from "../errors.js";

export interface SkillMetadata {
  name: string;
  description?: string;
}

export async function extractSkillMetadata(filePath: string): Promise<SkillMetadata> {
  const content = await readFile(filePath, "utf8");
  const frontmatter = parseFrontmatter(content, filePath);
  const name = frontmatter.name ?? firstHeading(content) ?? basename(dirname(filePath));
  const description = frontmatter.description ?? firstParagraph(content);
  return { name, description };
}

function parseFrontmatter(
  content: string,
  filePath: string,
): Partial<Record<"name" | "description", string>> {
  if (!content.startsWith("---\n")) {
    return {};
  }
  const end = content.indexOf("\n---", 4);
  if (end < 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(content.slice(4, end));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AgentPackError(`malformed skill frontmatter in ${filePath}: ${detail}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AgentPackError(`skill frontmatter must be a YAML object: ${filePath}`);
  }
  const raw = parsed as Record<string, unknown>;
  validateOptionalString(raw.name, "name", filePath);
  validateOptionalString(raw.description, "description", filePath);
  return {
    name: typeof raw.name === "string" ? raw.name : undefined,
    description: typeof raw.description === "string" ? raw.description : undefined,
  };
}

function validateOptionalString(value: unknown, field: string, filePath: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new AgentPackError(`skill frontmatter ${field} must be a string: ${filePath}`);
  }
}

function firstHeading(content: string): string | undefined {
  const line = content.split(/\r?\n/).find((entry) => entry.startsWith("# "));
  return line?.replace(/^#\s+/, "").trim() || undefined;
}

function firstParagraph(content: string): string | undefined {
  const withoutFrontmatter = content.startsWith("---\n")
    ? content.slice(content.indexOf("\n---", 4) + 4)
    : content;
  const paragraphs = withoutFrontmatter
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph && !paragraph.startsWith("#"));
  const first = paragraphs[0]?.replace(/\s+/g, " ").trim();
  return first ? first.slice(0, 300) : undefined;
}
