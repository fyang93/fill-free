import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "./types";

function notePath(config: AppConfig, relativePath: string): string {
  return path.join(config.paths.repoRoot, relativePath);
}

function readMarkdownNote(filePath: string): string {
  if (!existsSync(filePath)) return "";
  try {
    return readFileSync(filePath, "utf8").trim();
  } catch {
    return "";
  }
}

function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

function compactMarkdown(content: string): string[] {
  return stripFrontmatter(content)
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]));
}

export function describePromptPreferences(config: AppConfig, _text: string): string[] {
  const preferenceNote = readMarkdownNote(notePath(config, "memory/preferences.md"));
  if (!preferenceNote) return [];
  return ["Preference note (memory/preferences.md):", ...compactMarkdown(preferenceNote)];
}
