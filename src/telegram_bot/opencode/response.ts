import type { PromptAttachment } from "../types";
import type { OpenCodeMessage, PromptReminderDraft, PromptResult } from "./types";

function normalizeReminderDraft(raw: unknown): PromptReminderDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;

  if (typeof record.title === "string" && record.title.trim() && record.schedule && typeof record.schedule === "object") {
    return record as PromptReminderDraft;
  }

  const title = typeof record.text === "string" ? record.text.trim() : "";
  const due = typeof record.due === "string" ? record.due.trim() : "";
  if (!title || !due) return null;

  return {
    title,
    kind: "task",
    timeSemantics: "absolute",
    schedule: { kind: "once", scheduledAt: due },
    notifications: [{ offsetMinutes: 0 }],
    category: "routine",
  };
}

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
      const parsed = JSON.parse(candidate) as { message?: unknown; files?: unknown; reminders?: unknown };
      if (typeof parsed.message === "string") {
        return {
          message: parsed.message.trim() || "Done.",
          files: Array.isArray(parsed.files)
            ? parsed.files.filter((item): item is string => typeof item === "string")
            : [],
          attachments,
          reminders: Array.isArray(parsed.reminders)
            ? parsed.reminders.map(normalizeReminderDraft).filter((item): item is PromptReminderDraft => Boolean(item))
            : [],
        };
      }
    } catch {
      // try next candidate
    }
  }

  return { message: plain || "Done.", files: [], attachments, reminders: [] };
}
