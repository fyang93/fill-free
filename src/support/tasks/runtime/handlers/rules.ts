import { listRules, removeRule, upsertRule } from "operations/context/rules-store";
import type { RuleRecord } from "operations/context/store";
import type { TaskHandler } from "./types";

function cleanObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function cleanText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.map(cleanText).filter((item): item is string => Boolean(item));
  return items.length > 0 ? items : undefined;
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

export const rulesTaskHandler: TaskHandler = {
  name: "rules",
  supports: (task) => task.domain === "rules",
  run: async ({ config }, task) => {
    if (task.operation === "upsert") {
      const topic = cleanText(task.payload.topic);
      const appliesTo = normalizeAppliesTo(task.payload.appliesTo);
      const content = cleanObject(task.payload.content);
      if (!topic || !appliesTo || !content) {
        return { result: { skipped: true, reason: "invalid-rule-payload" } };
      }
      const written = upsertRule(config.paths.repoRoot, {
        id: cleanText(task.payload.id),
        topic,
        appliesTo,
        content,
        createdBy: task.source?.requesterUserId != null ? String(task.source.requesterUserId) : undefined,
      });
      return { result: { changed: true, id: written.id, topic: written.topic } };
    }

    if (task.operation === "delete") {
      const id = cleanText(task.payload.id);
      const topic = cleanText(task.payload.topic);
      const appliesTo = normalizeAppliesTo(task.payload.appliesTo);
      const changed = id
        ? removeRule(config.paths.repoRoot, { id })
        : topic && appliesTo
          ? removeRule(config.paths.repoRoot, { topic, appliesTo })
          : false;
      return { result: changed ? { changed: true } : { skipped: true, reason: "rule-not-found" } };
    }

    if (task.operation === "list") {
      const rules = listRules(config.paths.repoRoot);
      return { result: { changed: false, count: rules.length } };
    }

    return { result: { skipped: true, reason: "unsupported-rule-operation" } };
  },
};
