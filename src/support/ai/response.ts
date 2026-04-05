import type { AiTurnResult, FileWriteDraft, MessageDeliveryDraft, PendingAuthorizationDraft, ReminderDraft, TaskDraft } from "./types";

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
    || /"(?:message|files|reminders|deliveries|pendingAuthorizations|tasks)"\s*:/i.test(trimmed);
}

export function looksLikeFakeProcessNarration(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/\[(输出开始|输出结束|output start|output end)\]/i.test(trimmed)) return true;
  if (/^(计算中|检索中|检索到|扫描中|扫描到|加载中|协议加载中|processing|retrieving|scanning|loading)\b/im.test(trimmed)) return true;
  if (/(系统待命|protocol loaded|scan complete|retrieval complete)\b/i.test(trimmed)) return true;
  return false;
}

export function looksLikeUnconfirmedExecutionClaim(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return /(已发送|发送成功|已完成|完成了|已保存|已写入|已更新|已删除|已修改|发送到了|delivered|sent successfully|completed|saved|updated|deleted)/i.test(trimmed);
}

export function looksLikeInternalExecutionLeak(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/(chatId|recipientId|messageId|Telegram Bot API|tool name|invoke block|内部|internal stage|API)/i.test(trimmed)) return true;
  if (/-?chatId:|-100\d{6,}/.test(trimmed)) return true;
  if (/(无法直接发送 Telegram 消息|cannot directly send telegram message)/i.test(trimmed)) return true;
  return false;
}

export function isDisplayableUserText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (looksLikeStructuredOutputIntent(trimmed) && !/^\s*\{[\s\S]*\}\s*$/.test(trimmed)) return false;
  if (/(<invoke\b|<\/minimax:tool_call>|<tool_call\b|<function_calls?\b)/i.test(trimmed)) return false;
  if (/^<[^>]+>[\s\S]*<\/[^>]+>$/.test(trimmed)) return false;
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

function parseFileWrites(value: unknown): FileWriteDraft[] {
  if (!Array.isArray(value)) return [];
  const drafts: FileWriteDraft[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const filePath = typeof record.path === "string" ? record.path.trim() : "";
    const content = typeof record.content === "string" ? record.content : "";
    if (!filePath || !content.trim()) continue;
    drafts.push({
      path: filePath,
      content,
      operation: typeof record.operation === "string" ? record.operation.trim() : undefined,
      action: typeof record.action === "string" ? record.action.trim() : undefined,
    });
  }
  return drafts;
}

function parseReminders(value: unknown): ReminderDraft[] {
  return Array.isArray(value)
    ? value.filter((item): item is ReminderDraft => Boolean(item) && typeof item === "object" && typeof (item as Record<string, unknown>).title === "string" && Boolean((item as Record<string, unknown>).title) && typeof (item as Record<string, unknown>).schedule === "object" && Boolean((item as Record<string, unknown>).schedule))
    : [];
}

function parseDeliveries(value: unknown): MessageDeliveryDraft[] {
  if (!Array.isArray(value)) return [];
  const drafts: MessageDeliveryDraft[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const content = typeof record.content === "string" ? record.content.trim() : "";
    const recipient = record.recipient && typeof record.recipient === "object" && !Array.isArray(record.recipient)
      ? record.recipient as MessageDeliveryDraft["recipient"]
      : undefined;
    if (!content || !recipient) continue;
    drafts.push({
      content,
      recipient,
      sendAt: trimmedString(record.sendAt),
    });
  }
  return drafts;
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
      const parsed = JSON.parse(candidate) as { message?: unknown; answerMode?: unknown; files?: unknown; reminders?: unknown; deliveries?: unknown; pendingAuthorizations?: unknown; tasks?: unknown };
      const files = parseFiles(parsed.files);
      const reminders = parseReminders(parsed.reminders);
      const fileWrites = parseFileWrites(parsed.files);
      const deliveries = parseDeliveries(parsed.deliveries);
      const pendingAuthorizations = parsePendingAuthorizations(parsed.pendingAuthorizations);
      const tasks = parseTasks(parsed.tasks);
      const messageText = typeof parsed.message === "string" ? parsed.message.trim() : "";
      const answerMode = parsed.answerMode === "needs-execution"
        ? "needs-execution"
        : parsed.answerMode === "needs-clarification"
          ? "needs-clarification"
          : "direct";
      const hasStructuredFields = files.length > 0 || fileWrites.length > 0 || reminders.length > 0 || deliveries.length > 0 || pendingAuthorizations.length > 0 || tasks.length > 0 || Array.isArray(parsed.files) || Array.isArray(parsed.reminders) || Array.isArray(parsed.deliveries) || Array.isArray(parsed.pendingAuthorizations) || Array.isArray(parsed.tasks);
      if (typeof parsed.message === "string" || hasStructuredFields) {
        return {
          message: messageText,
          answerMode,
          files,
          attachments: [],
          fileWrites,
          reminders,
          deliveries,
          pendingAuthorizations,
          tasks,
        };
      }
    } catch {
      // try next candidate
    }
  }

  if (looksLikeStructuredOutputIntent(plain) && jsonCandidates.length > 0) {
    return { message: "", answerMode: "direct", files: [], fileWrites: [], attachments: [], reminders: [], deliveries: [], pendingAuthorizations: [], tasks: [] };
  }

  return {
    message: plain,
    answerMode: "direct",
    files: [],
    attachments: [],
    fileWrites: [],
    reminders: [],
    deliveries: [],
    pendingAuthorizations: [],
    tasks: [],
  };
}
