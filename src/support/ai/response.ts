import type { AiTurnResult, OutboundMessageDraft, PendingAuthorizationDraft, ReminderDraft, TaskDraft } from "./types";

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const trimmed = text.trim();
  if (trimmed) candidates.push(trimmed);

  const fenceMatches = Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g))
    .map((match) => (match[1] || "").trim())
    .filter(Boolean);
  candidates.push(...fenceMatches);

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1).trim());
  }

  return Array.from(new Set(candidates));
}

export function looksLikeStructuredOutputIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /```(?:json)?/i.test(trimmed)
    || /^\s*\{[\s\S]*\}\s*$/.test(trimmed)
    || /"(?:message|files|reminders|outboundMessages|pendingAuthorizations|tasks)"\s*:/i.test(trimmed);
}

export function isDisplayableUserText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (looksLikeStructuredOutputIntent(trimmed) && !/^\s*\{[\s\S]*\}\s*$/.test(trimmed)) return false;
  return true;
}

function trimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseFiles(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseReminders(value: unknown): ReminderDraft[] {
  return Array.isArray(value)
    ? value.filter((item): item is ReminderDraft => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).title === "string" && Boolean((item as Record<string, unknown>).title) && typeof (item as Record<string, unknown>).schedule === "object" && Boolean((item as Record<string, unknown>).schedule))
    : [];
}

function parseOutboundMessages(value: unknown): OutboundMessageDraft[] {
  return Array.isArray(value)
    ? value.filter((item): item is OutboundMessageDraft => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).message === "string" && Boolean(((item as Record<string, unknown>).message as string).trim()))
    : [];
}

function parsePendingAuthorizations(value: unknown): PendingAuthorizationDraft[] {
  return Array.isArray(value)
    ? value.filter((item): item is PendingAuthorizationDraft => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).username === "string" && Boolean(((item as Record<string, unknown>).username as string).trim()) && typeof (item as Record<string, unknown>).expiresAt === "string" && Boolean(((item as Record<string, unknown>).expiresAt as string).trim()))
    : [];
}

function parseTasks(value: unknown): TaskDraft[] {
  return Array.isArray(value)
    ? value.filter((item): item is TaskDraft => {
        if (!item || typeof item !== "object") return false;
        const record = item as Record<string, unknown>;
        return typeof record.domain === "string" && record.domain.trim().length > 0
          && typeof record.operation === "string" && record.operation.trim().length > 0;
      }).map((item) => {
        const record = item as Record<string, unknown>;
        return {
          domain: trimmedString(record.domain) || "",
          operation: trimmedString(record.operation) || "",
          subject: record.subject && typeof record.subject === "object" && !Array.isArray(record.subject)
            ? record.subject as TaskDraft["subject"]
            : undefined,
          payload: record.payload && typeof record.payload === "object" && !Array.isArray(record.payload)
            ? record.payload as Record<string, unknown>
            : undefined,
          dependsOn: Array.isArray(record.dependsOn) ? record.dependsOn.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()) : undefined,
          dedupeKey: trimmedString(record.dedupeKey),
          supersedesTaskIds: Array.isArray(record.supersedesTaskIds) ? record.supersedesTaskIds.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()) : undefined,
        };
      })
    : [];
}

export function extractAiTurnResultFromText(rawText: string): AiTurnResult {
  const plain = rawText.trim();
  const jsonCandidates = extractJsonCandidates(plain);

  for (const candidate of jsonCandidates) {
    try {
      const parsed = JSON.parse(candidate) as { message?: unknown; files?: unknown; reminders?: unknown; outboundMessages?: unknown; pendingAuthorizations?: unknown; tasks?: unknown };
      const files = parseFiles(parsed.files);
      const reminders = parseReminders(parsed.reminders);
      const outboundMessages = parseOutboundMessages(parsed.outboundMessages);
      const pendingAuthorizations = parsePendingAuthorizations(parsed.pendingAuthorizations);
      const tasks = parseTasks(parsed.tasks);
      const messageText = typeof parsed.message === "string" ? parsed.message.trim() : "";
      const hasStructuredFields = files.length > 0 || reminders.length > 0 || outboundMessages.length > 0 || pendingAuthorizations.length > 0 || tasks.length > 0 || Array.isArray(parsed.files) || Array.isArray(parsed.reminders) || Array.isArray(parsed.outboundMessages) || Array.isArray(parsed.pendingAuthorizations) || Array.isArray(parsed.tasks);
      if (typeof parsed.message === "string" || hasStructuredFields) {
        return {
          message: messageText,
          files,
          attachments: [],
          reminders,
          outboundMessages,
          pendingAuthorizations,
          tasks,
        };
      }
    } catch {
      // try next candidate
    }
  }

  if (looksLikeStructuredOutputIntent(plain) && jsonCandidates.length > 0) {
    return { message: "", files: [], attachments: [], reminders: [], outboundMessages: [], pendingAuthorizations: [], tasks: [] };
  }

  return { message: plain, files: [], attachments: [], reminders: [], outboundMessages: [], pendingAuthorizations: [], tasks: [] };
}
