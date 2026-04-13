import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { RuleRecord } from "./store";

type RuleFile = { rules: RuleRecord[] };

type RuleSelector = {
  id?: string;
  topic?: string;
  appliesTo?: RuleRecord["appliesTo"];
};

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value
    .map(cleanText)
    .filter((item): item is string => Boolean(item))
    .sort((a, b) => a.localeCompare(b));
  return items.length > 0 ? items : undefined;
}

function cleanObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function rulesFilePath(repoRoot: string): string {
  return path.join(repoRoot, "system", "rules.json");
}

function normalizeAppliesTo(value: unknown): RuleRecord["appliesTo"] | null {
  const record = cleanObject(value);
  const domain = cleanText(record?.domain);
  if (!domain) return null;
  return {
    domain,
    selector: cleanText(record?.selector),
    userIds: cleanStringArray(record?.userIds),
    chatIds: cleanStringArray(record?.chatIds),
    taskIds: cleanStringArray(record?.taskIds),
  };
}

function normalizeRule(value: unknown): RuleRecord | null {
  const record = cleanObject(value);
  if (!record) return null;
  const id = cleanText(record.id);
  const topic = cleanText(record.topic);
  const appliesTo = normalizeAppliesTo(record.appliesTo);
  const content = cleanObject(record.content);
  if (!id || !topic || !appliesTo || !content) return null;
  return {
    id,
    appliesTo,
    topic,
    content,
    createdBy: cleanText(record.createdBy),
    updatedAt: cleanText(record.updatedAt),
  };
}

function readRuleFile(repoRoot: string): RuleFile {
  const filePath = rulesFilePath(repoRoot);
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { rules?: unknown };
    const rules = Array.isArray(parsed.rules)
      ? parsed.rules.map(normalizeRule).filter((rule): rule is RuleRecord => Boolean(rule))
      : [];
    return { rules };
  } catch {
    return { rules: [] };
  }
}

function writeRuleFile(repoRoot: string, file: RuleFile): void {
  const filePath = rulesFilePath(repoRoot);
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify({ rules: file.rules }, null, 2)}\n`, "utf8");
}

function sameStringArray(a?: string[], b?: string[]): boolean {
  const left = a || [];
  const right = b || [];
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

export function sameRuleApplicability(a: RuleRecord["appliesTo"], b: RuleRecord["appliesTo"]): boolean {
  return a.domain === b.domain
    && (a.selector || "") === (b.selector || "")
    && sameStringArray(a.userIds, b.userIds)
    && sameStringArray(a.chatIds, b.chatIds)
    && sameStringArray(a.taskIds, b.taskIds);
}

export function sameRuleSlot(a: Pick<RuleRecord, "topic" | "appliesTo">, b: Pick<RuleRecord, "topic" | "appliesTo">): boolean {
  return a.topic === b.topic && sameRuleApplicability(a.appliesTo, b.appliesTo);
}

function buildRuleId(topic: string): string {
  const slug = topic
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "rule";
  return `${slug}-${Date.now().toString(36)}`;
}

function normalizeForWrite(input: Omit<RuleRecord, "id" | "updatedAt"> & Partial<Pick<RuleRecord, "id" | "updatedAt">>): RuleRecord {
  const normalizedAppliesTo = normalizeAppliesTo(input.appliesTo);
  if (!normalizedAppliesTo) throw new Error("Rule appliesTo.domain is required");
  const topic = cleanText(input.topic);
  if (!topic) throw new Error("Rule topic is required");
  const content = cleanObject(input.content);
  if (!content) throw new Error("Rule content must be an object");
  return {
    id: cleanText(input.id) || buildRuleId(topic),
    appliesTo: normalizedAppliesTo,
    topic,
    content,
    createdBy: cleanText(input.createdBy),
    updatedAt: cleanText(input.updatedAt) || new Date().toISOString(),
  };
}

export function upsertRule(repoRoot: string, input: Omit<RuleRecord, "id" | "updatedAt"> & Partial<Pick<RuleRecord, "id" | "updatedAt">>): RuleRecord {
  const next = normalizeForWrite(input);
  const file = readRuleFile(repoRoot);
  const index = file.rules.findIndex((rule) => rule.id === next.id || sameRuleSlot(rule, next));
  const written = index >= 0
    ? { ...file.rules[index], ...next, updatedAt: new Date().toISOString() }
    : next;
  if (index >= 0) {
    file.rules[index] = written;
  } else {
    file.rules.push(written);
  }
  writeRuleFile(repoRoot, file);
  return written;
}

export function removeRule(repoRoot: string, selector: RuleSelector): boolean {
  const file = readRuleFile(repoRoot);
  const appliesTo = selector.appliesTo ? normalizeAppliesTo(selector.appliesTo) : null;
  const before = file.rules.length;
  file.rules = file.rules.filter((rule) => {
    if (selector.id && rule.id === selector.id) return false;
    if (selector.topic && appliesTo && rule.topic === selector.topic && sameRuleApplicability(rule.appliesTo, appliesTo)) return false;
    return true;
  });
  if (file.rules.length === before) return false;
  writeRuleFile(repoRoot, file);
  return true;
}

export function listRules(repoRoot: string): RuleRecord[] {
  return readRuleFile(repoRoot).rules;
}
