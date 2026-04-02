import type { PromptResult, PromptOutboundMessageDraft, PromptPendingAuthorizationDraft, PromptReminderDraft } from "./types";

const DEFAULT_JSON_MESSAGE = "Done.";

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
    || /"(?:message|files|reminders|outboundMessages|pendingAuthorizations)"\s*:/i.test(trimmed);
}

function parseFiles(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseReminders(value: unknown): PromptReminderDraft[] {
  return Array.isArray(value)
    ? value.filter((item): item is PromptReminderDraft => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).title === "string" && Boolean((item as Record<string, unknown>).title) && typeof (item as Record<string, unknown>).schedule === "object" && Boolean((item as Record<string, unknown>).schedule))
    : [];
}

function parseOutboundMessages(value: unknown): PromptOutboundMessageDraft[] {
  return Array.isArray(value)
    ? value.filter((item): item is PromptOutboundMessageDraft => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).message === "string" && Boolean(((item as Record<string, unknown>).message as string).trim()))
    : [];
}

function parsePendingAuthorizations(value: unknown): PromptPendingAuthorizationDraft[] {
  return Array.isArray(value)
    ? value.filter((item): item is PromptPendingAuthorizationDraft => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).username === "string" && Boolean(((item as Record<string, unknown>).username as string).trim()) && typeof (item as Record<string, unknown>).expiresAt === "string" && Boolean(((item as Record<string, unknown>).expiresAt as string).trim()))
    : [];
}

export function extractPromptResultFromText(rawText: string): PromptResult {
  const plain = rawText.trim();

  for (const candidate of extractJsonCandidates(plain)) {
    try {
      const parsed = JSON.parse(candidate) as { message?: unknown; files?: unknown; reminders?: unknown; outboundMessages?: unknown; pendingAuthorizations?: unknown };
      const files = parseFiles(parsed.files);
      const reminders = parseReminders(parsed.reminders);
      const outboundMessages = parseOutboundMessages(parsed.outboundMessages);
      const pendingAuthorizations = parsePendingAuthorizations(parsed.pendingAuthorizations);
      const messageText = typeof parsed.message === "string" ? parsed.message.trim() : "";
      const hasStructuredFields = files.length > 0 || reminders.length > 0 || outboundMessages.length > 0 || pendingAuthorizations.length > 0 || Array.isArray(parsed.files) || Array.isArray(parsed.reminders) || Array.isArray(parsed.outboundMessages) || Array.isArray(parsed.pendingAuthorizations);
      if (typeof parsed.message === "string" || hasStructuredFields) {
        return {
          message: messageText || DEFAULT_JSON_MESSAGE,
          files,
          attachments: [],
          reminders,
          outboundMessages,
          pendingAuthorizations,
        };
      }
    } catch {
      // try next candidate
    }
  }

  return { message: plain || DEFAULT_JSON_MESSAGE, files: [], attachments: [], reminders: [], outboundMessages: [], pendingAuthorizations: [] };
}
