import { readFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import YAML from "yaml";

export interface SkillMetadata {
  name: string;
  description?: string;
}

export async function extractSkillMetadata(filePath: string): Promise<SkillMetadata> {
  const content = await readFile(filePath, "utf8");
  const frontmatter = parseFrontmatter(content);
  const name = frontmatter.name ?? firstHeading(content) ?? basename(dirname(filePath));
  const description = frontmatter.description ?? firstParagraph(content);
  return { name, description };
}

function parseFrontmatter(content: string): Record<string, string> {
  if (!content.startsWith("---\n")) {
    return {};
  }
  const end = content.indexOf("\n---", 4);
  if (end < 0) {
    return {};
  }
  const parsed = YAML.parse(content.slice(4, end));
  return typeof parsed === "object" && parsed ? parsed : {};
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
