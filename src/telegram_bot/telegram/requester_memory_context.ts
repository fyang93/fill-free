import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AppConfig } from "../types";
import { state } from "../state";

type Frontmatter = {
  title?: string;
  summary?: string;
  aliases?: string[];
};

type Candidate = {
  relativePath: string;
  score: number;
  matchedTerms: string[];
  title?: string;
  summary?: string;
  aliases?: string[];
};

function readText(filePath: string): string {
  try {
    return readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

function parseFrontmatter(content: string): Frontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const frontmatter = match[1];
  const title = frontmatter.match(/^title:\s*(.+)$/m)?.[1]?.trim()?.replace(/^"|"$/g, "");
  const summary = frontmatter.match(/^summary:\s*(.+)$/m)?.[1]?.trim()?.replace(/^"|"$/g, "");
  const aliasesLine = frontmatter.match(/^aliases:\s*(\[[^\n]+\])$/m)?.[1]?.trim();
  let aliases: string[] | undefined;
  if (aliasesLine) {
    try {
      const parsed = JSON.parse(aliasesLine) as unknown;
      if (Array.isArray(parsed)) {
        aliases = parsed
          .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          .map((item) => item.trim());
      }
    } catch {
      // ignore malformed aliases
    }
  }
  return { title, summary, aliases };
}

function collectMemoryMarkdownFiles(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectMemoryMarkdownFiles(absolute, acc);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith(".md")) acc.push(absolute);
  }
  return acc;
}

function normalizedTerms(config: AppConfig, requesterUserId: number | undefined, fallback?: { username?: string; first_name?: string; last_name?: string }): string[] {
  if (!requesterUserId) return [];
  const known = state.telegramUsers[String(requesterUserId)];
  const fullFallbackName = [fallback?.first_name, fallback?.last_name].filter(Boolean).join(" ").trim();
  const fullKnownName = [known?.firstName, known?.lastName].filter(Boolean).join(" ").trim();
  const rawTerms = [
    known?.username,
    fallback?.username,
    known?.displayName,
    known?.firstName,
    known?.lastName,
    fullKnownName,
    fullFallbackName,
  ];
  return Array.from(new Set(rawTerms
    .map((item) => typeof item === "string" ? item.trim().replace(/^@+/, "").toLowerCase() : undefined)
    .filter((item): item is string => typeof item === "string" && item.length >= 2)));
}

function candidateForFile(repoRoot: string, absolutePath: string, terms: string[]): Candidate | null {
  const content = readText(absolutePath);
  if (!content) return null;
  const frontmatter = parseFrontmatter(content);
  const title = frontmatter.title?.toLowerCase() || "";
  const summary = frontmatter.summary?.toLowerCase() || "";
  const aliases = (frontmatter.aliases || []).map((item) => item.toLowerCase());
  const body = content.toLowerCase();
  const matchedTerms = terms.filter((term) => title.includes(term) || summary.includes(term) || aliases.some((alias) => alias.includes(term)) || body.includes(term));
  if (matchedTerms.length === 0) return null;

  let score = 0;
  for (const term of matchedTerms) {
    if (title.includes(term)) score += 4;
    if (aliases.some((alias) => alias.includes(term))) score += 4;
    if (summary.includes(term)) score += 2;
    if (body.includes(term)) score += 1;
  }

  return {
    relativePath: path.relative(repoRoot, absolutePath),
    score,
    matchedTerms,
    title: frontmatter.title,
    summary: frontmatter.summary,
    aliases: frontmatter.aliases,
  };
}

export function buildRequesterMemoryContext(config: AppConfig, requesterUserId: number | undefined, fallback?: { username?: string; first_name?: string; last_name?: string }): string[] {
  const terms = normalizedTerms(config, requesterUserId, fallback);
  if (terms.length === 0) return [];

  const memoryDir = path.join(config.paths.repoRoot, "memory");
  const candidates = collectMemoryMarkdownFiles(memoryDir)
    .map((filePath) => candidateForFile(config.paths.repoRoot, filePath, terms))
    .filter((item): item is Candidate => Boolean(item))
    .sort((a, b) => b.score - a.score || a.relativePath.localeCompare(b.relativePath))
    .slice(0, 3);

  if (candidates.length === 0) return [];

  return [
    "Requester memory candidates:",
    ...candidates.map((candidate) => {
      const parts = [
        candidate.relativePath,
        candidate.title ? `title=${JSON.stringify(candidate.title)}` : "",
        candidate.summary ? `summary=${JSON.stringify(candidate.summary)}` : "",
        candidate.aliases && candidate.aliases.length > 0 ? `aliases=${JSON.stringify(candidate.aliases)}` : "",
        `matchedTerms=${JSON.stringify(candidate.matchedTerms)}`,
      ].filter(Boolean);
      return `- ${parts.join(", ")}`;
    }),
  ];
}
