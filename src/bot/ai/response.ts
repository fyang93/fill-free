import type { AiTurnResult } from "./types";

export function isExactTaggedBlock(tag: string, text: string): boolean {
  const trimmed = text.trim();
  return new RegExp(`^\\[${tag}\\]\\s*[\\s\\S]*?\\s*\\[\\/${tag}\\]$`, "i").test(trimmed);
}

export function looksLikeStructuredOutputIntent(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /^\s*\[(?:response|answer)\][\s\S]*\[\/(?:response|answer)\]\s*$/i.test(trimmed)
    || /^```(?:json)?/i.test(trimmed)
    || /(^|\n)(?:answer_mode|message|deliveries|schedules|pending_authorizations|tasks|file_writes)\s*:/i.test(trimmed)
    || /"(?:answer_mode|message|deliveries|schedules|pending_authorizations|tasks|file_writes)"\s*:/.test(trimmed);
}

function looksLikeMalformedStructuredTurnResult(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^```(?:json)?/i.test(trimmed)) return true;
  if (/\[TOOL_CALL\][\s\S]*\[\/TOOL_CALL\]/i.test(trimmed)) return true;
  if (/"answer_mode"\s*:/.test(trimmed)) return true;
  if (/(^|\n)\s*answer_mode\s*:/i.test(trimmed)) return true;
  if (/^\s*\[(?:response|answer)\][\s\S]*\[\/(?:response|answer)\]\s*$/i.test(trimmed)) return true;
  return false;
}

export function isDisplayableUserText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (looksLikeStructuredOutputIntent(trimmed) && !/^\s*\[(?:response|answer)\][\s\S]*\[\/(?:response|answer)\]\s*$/i.test(trimmed)) return false;
  if (/(<invoke\b|<\/minimax:tool_call>|<tool_call\b|<function_calls?\b)/i.test(trimmed)) return false;
  if (/\[TOOL_CALL\][\s\S]*\[\/TOOL_CALL\]/i.test(trimmed)) return false;
  if (/\{tool\s*=>/i.test(trimmed)) return false;
  if (/<\/?[a-z][a-z0-9:_-]*\b[^>]*>/i.test(trimmed)) return false;
  if (/^<[^>]+>[\s\S]*<\/[^>]+>$/.test(trimmed)) return false;
  return true;
}


function emptyTurnResult(): AiTurnResult {
  return { message: "", files: [], fileWrites: [], attachments: [], schedules: [], deliveries: [], pendingAuthorizations: [], tasks: [] };
}

export function extractDirectTurnResultFromText(rawText: string): AiTurnResult {
  const plain = rawText.trim();
  if (!plain) return emptyTurnResult();
  if (looksLikeMalformedStructuredTurnResult(plain) || looksLikeStructuredOutputIntent(plain)) return emptyTurnResult();

  return {
    ...emptyTurnResult(),
    message: plain,
  };
}

export function validateStructuredTurnResult(_rawText: string, _parsed: AiTurnResult): string[] {
  return [];
}

export function extractAiTurnResultFromText(rawText: string): AiTurnResult {
  return extractDirectTurnResultFromText(rawText);
}
