import type { PromptAttachment } from "../types";
import type { OpenCodeMessage, PromptOutboundMessageDraft, PromptReminderDraft, PromptResult } from "./types";

const DEFAULT_JSON_MESSAGE = "Done.";

export function parseModel(model: string | null): { providerID: string; modelID: string } | null {
  if (!model) return null;
  const index = model.indexOf("/");
  if (index <= 0 || index === model.length - 1) return null;
  return {
    providerID: model.slice(0, index),
    modelID: model.slice(index + 1),
  };
}

export function extractText(message: OpenCodeMessage): string {
  const parts = message.parts || [];
  const texts = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim())
    .filter(Boolean);
  if (texts.length > 0) return texts.join("\n\n");
  if (parts.some((part) => part.type === "file")) return "Generated attachment output.";
  return "Completed with no displayable text output.";
}

export function summarizeParts(message: OpenCodeMessage): Array<Record<string, unknown>> {
  return (message.parts || []).map((part) => ({
    type: part.type || "unknown",
    textLength: typeof part.text === "string" ? part.text.length : 0,
    mime: part.mime,
    filename: part.filename,
    hasUrl: typeof part.url === "string",
  }));
}

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
    || /"(?:message|files|reminders|outboundMessages)"\s*:/i.test(trimmed);
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

export function extractPromptResult(message: OpenCodeMessage): PromptResult {
  const plain = extractText(message).trim();
  const attachments: PromptAttachment[] = (message.parts || [])
    .filter((part) => part.type === "file" && typeof part.url === "string" && typeof part.mime === "string")
    .map((part) => ({
      mimeType: part.mime as string,
      filename: typeof part.filename === "string" ? part.filename : undefined,
      url: part.url as string,
    }));

  for (const candidate of extractJsonCandidates(plain)) {
    try {
      const parsed = JSON.parse(candidate) as { message?: unknown; files?: unknown; reminders?: unknown; outboundMessages?: unknown };
      const files = parseFiles(parsed.files);
      const reminders = parseReminders(parsed.reminders);
      const outboundMessages = parseOutboundMessages(parsed.outboundMessages);
      const messageText = typeof parsed.message === "string" ? parsed.message.trim() : "";
      const hasStructuredFields = files.length > 0 || reminders.length > 0 || outboundMessages.length > 0 || Array.isArray(parsed.files) || Array.isArray(parsed.reminders) || Array.isArray(parsed.outboundMessages);
      if (typeof parsed.message === "string" || hasStructuredFields) {
        return {
          message: messageText || DEFAULT_JSON_MESSAGE,
          files,
          attachments,
          reminders,
          outboundMessages,
        };
      }
    } catch {
      // try next candidate
    }
  }

  return { message: plain || DEFAULT_JSON_MESSAGE, files: [], attachments, reminders: [], outboundMessages: [] };
}
