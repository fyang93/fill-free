import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type InvertedIndexEntry = {
  paths: string[];
  updatedAt: string;
  lastConfirmedAt?: string;
  lastUsedAt?: string;
};

export type InvertedIndex = {
  terms: Record<string, InvertedIndexEntry>;
};

let indexMutationQueue: Promise<void> = Promise.resolve();

function indexPath(repoRoot: string): string {
  return path.join(repoRoot, "system", "inverted-index.json");
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizePath(value: string): string | undefined {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized.startsWith("memory/") || !normalized.endsWith(".md")) return undefined;
  return normalized;
}

export function normalizeIndexTerm(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values.map(normalizeIndexTerm).filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

async function walkMemoryFiles(root: string, dir = root): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const nested = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walkMemoryFiles(root, fullPath);
    if (!entry.isFile() || !entry.name.endsWith(".md")) return [];
    return [path.relative(root, fullPath).replace(/\\/g, "/")];
  }));
  return nested.flat().sort((a, b) => a.localeCompare(b));
}

function extractFrontmatterBlock(text: string): { block: string; body: string } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("---\n") && !trimmed.startsWith("---\r\n")) return null;
  const match = trimmed.match(/^(---\r?\n([\s\S]*?)\r?\n---)(?:\r?\n|$)/);
  if (!match) return null;
  return { block: match[1], body: match[2] || "" };
}

export function extractMemoryKeywords(text: string): string[] {
  const frontmatter = extractFrontmatterBlock(text);
  if (!frontmatter) return [];
  const lines = frontmatter.body.split(/\r?\n/);
  const keywords: string[] = [];
  let inKeywords = false;
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!inKeywords) {
      if (/^keywords\s*:\s*$/.test(trimmedLine)) {
        inKeywords = true;
        continue;
      }
      if (/^keywords\s*:\s*\[.*\]\s*$/.test(trimmedLine)) {
        const inline = trimmedLine.replace(/^keywords\s*:\s*\[/, "").replace(/\]\s*$/, "");
        const values = inline.split(",").map((item) => item.trim().replace(/^['\"]|['\"]$/g, "")).filter(Boolean);
        keywords.push(...values);
      }
      continue;
    }
    if (!trimmedLine) continue;
    if (!trimmedLine.startsWith("- ")) break;
    keywords.push(trimmedLine.slice(2).trim().replace(/^['\"]|['\"]$/g, ""));
  }
  return uniqueSorted(keywords);
}

export function upsertMemoryKeywords(text: string, keywords: string[]): string {
  const normalizedKeywords = uniqueSorted(keywords).slice(0, 8);
  if (normalizedKeywords.length === 0) return text;
  const keywordsBlock = ["keywords:", ...normalizedKeywords.map((keyword) => `  - ${keyword}`)].join("\n");
  const frontmatter = extractFrontmatterBlock(text);
  if (!frontmatter) {
    const trimmed = text.trimStart();
    return `---\n${keywordsBlock}\n---\n${trimmed}${trimmed.endsWith("\n") ? "" : "\n"}`;
  }
  if (/^keywords\s*:/m.test(frontmatter.body)) return text;
  const replacement = `---\n${keywordsBlock}\n${frontmatter.body ? `${frontmatter.body}\n` : ""}---`;
  return text.replace(frontmatter.block, replacement);
}

export async function backfillMemoryKeywords(repoRoot: string, relativePath: string, keywords: string[]): Promise<boolean> {
  const normalizedPath = normalizePath(relativePath);
  if (!normalizedPath) return false;
  const filePath = path.join(repoRoot, normalizedPath);
  const text = await readFile(filePath, "utf8").catch(() => "");
  if (!text.trim() || extractMemoryKeywords(text).length > 0) return false;
  const next = upsertMemoryKeywords(text, keywords);
  if (next === text) return false;
  await writeFile(filePath, next, "utf8");
  return true;
}

export async function rebuildInvertedIndexFromMemoryKeywords(repoRoot: string): Promise<{ terms: number; files: number }> {
  const memoryRoot = path.join(repoRoot, "memory");
  const files = await walkMemoryFiles(memoryRoot);
  const nextTerms: Record<string, InvertedIndexEntry> = {};
  const now = new Date().toISOString();
  const previous = await loadIndex(repoRoot);

  for (const relativePath of files) {
    const normalizedPath = normalizePath(path.join("memory", relativePath).replace(/\\/g, "/"));
    if (!normalizedPath) continue;
    const absolutePath = path.join(repoRoot, normalizedPath);
    const text = await readFile(absolutePath, "utf8").catch(() => "");
    if (!text.trim()) continue;
    const keywords = extractMemoryKeywords(text);
    for (const keyword of keywords) {
      const normalizedTerm = normalizeIndexTerm(keyword);
      if (!normalizedTerm) continue;
      const previousEntry = previous.terms[normalizedTerm];
      const current = nextTerms[normalizedTerm];
      nextTerms[normalizedTerm] = {
        paths: uniqueSorted([...(current?.paths || []), normalizedPath]),
        updatedAt: now,
        lastConfirmedAt: previousEntry?.lastConfirmedAt || now,
        lastUsedAt: previousEntry?.lastUsedAt,
      };
    }
  }

  await writeIndex(repoRoot, { terms: nextTerms });
  return { terms: Object.keys(nextTerms).length, files: files.length };
}

async function loadIndex(repoRoot: string): Promise<InvertedIndex> {
  try {
    const parsed = JSON.parse(await readFile(indexPath(repoRoot), "utf8")) as { terms?: unknown };
    const terms = parsed.terms && typeof parsed.terms === "object" && !Array.isArray(parsed.terms)
      ? Object.fromEntries(
          Object.entries(parsed.terms as Record<string, unknown>)
            .map(([term, raw]) => {
              if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [term, undefined] as const;
              const record = raw as Record<string, unknown>;
              const paths = Array.isArray(record.paths)
                ? record.paths.map((item) => typeof item === "string" ? normalizePath(item) : undefined).filter((item): item is string => Boolean(item))
                : [];
              if (!term.trim() || paths.length === 0) return [term, undefined] as const;
              return [normalizeIndexTerm(term), {
                paths: Array.from(new Set(paths)).sort((a, b) => a.localeCompare(b)),
                updatedAt: cleanText(record.updatedAt) || new Date().toISOString(),
                lastConfirmedAt: cleanText(record.lastConfirmedAt),
                lastUsedAt: cleanText(record.lastUsedAt),
              } satisfies InvertedIndexEntry] as const;
            })
            .filter(([, entry]) => Boolean(entry)),
        ) as Record<string, InvertedIndexEntry>
      : {};
    return { terms };
  } catch {
    return { terms: {} };
  }
}

async function writeIndex(repoRoot: string, index: InvertedIndex): Promise<void> {
  const filePath = indexPath(repoRoot);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

async function mutateIndex<T>(repoRoot: string, operation: (index: InvertedIndex) => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const index = await loadIndex(repoRoot);
    const result = await operation(index);
    await writeIndex(repoRoot, index);
    return result;
  };
  const pending = indexMutationQueue.then(run, run);
  indexMutationQueue = pending.then(() => undefined, () => undefined);
  return pending;
}

export async function matchInvertedIndex(repoRoot: string, text: string): Promise<{ matchedTerms: string[]; paths: string[] }> {
  const normalizedText = normalizeIndexTerm(text);
  if (!normalizedText) return { matchedTerms: [], paths: [] };
  const index = await loadIndex(repoRoot);
  const matchedTerms = Object.keys(index.terms)
    .filter((term) => normalizedText.includes(term))
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
  const paths = Array.from(new Set(matchedTerms.flatMap((term) => index.terms[term]?.paths || [])));
  return { matchedTerms, paths };
}

export async function upsertInvertedIndexTerm(repoRoot: string, term: string, paths: string[]): Promise<void> {
  const normalizedTerm = normalizeIndexTerm(term);
  const normalizedPaths = Array.from(new Set(paths.map(normalizePath).filter((item): item is string => Boolean(item))));
  if (!normalizedTerm || normalizedPaths.length === 0) return;
  await mutateIndex(repoRoot, async (index) => {
    const now = new Date().toISOString();
    const previous = index.terms[normalizedTerm];
    index.terms[normalizedTerm] = {
      paths: Array.from(new Set([...(previous?.paths || []), ...normalizedPaths])).sort((a, b) => a.localeCompare(b)),
      updatedAt: now,
      lastConfirmedAt: now,
      lastUsedAt: previous?.lastUsedAt,
    };
  });
}

export async function touchInvertedIndexTerms(repoRoot: string, terms: string[], input?: { confirm?: boolean }): Promise<void> {
  if (terms.length === 0) return;
  await mutateIndex(repoRoot, async (index) => {
    const now = new Date().toISOString();
    for (const rawTerm of terms) {
      const term = normalizeIndexTerm(rawTerm);
      const current = index.terms[term];
      if (!current) continue;
      index.terms[term] = {
        ...current,
        lastUsedAt: now,
        lastConfirmedAt: input?.confirm ? now : current.lastConfirmedAt,
      };
    }
  });
}

export async function pruneInvalidInvertedIndex(repoRoot: string): Promise<{ removedTerms: number; removedPaths: number }> {
  return mutateIndex(repoRoot, async (index) => {
    let removedTerms = 0;
    let removedPaths = 0;
    const nextTerms: Record<string, InvertedIndexEntry> = {};
    for (const [term, entry] of Object.entries(index.terms)) {
      const checked = await Promise.all(entry.paths.map(async (filePath) => {
        if (!filePath.startsWith("memory/") || !filePath.endsWith(".md")) return null;
        try {
          const info = await stat(path.join(repoRoot, filePath));
          return info.isFile() ? filePath : null;
        } catch {
          return null;
        }
      }));
      const validPaths = checked.filter((filePath): filePath is string => Boolean(filePath));
      removedPaths += entry.paths.length - validPaths.length;
      if (validPaths.length === 0) {
        removedTerms += 1;
        continue;
      }
      nextTerms[term] = { ...entry, paths: validPaths };
    }
    index.terms = nextTerms;
    return { removedTerms, removedPaths };
  });
}
