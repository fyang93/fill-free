import type { AppConfig, AiAttachment, UploadedFile } from "scheduling/app/types";
import { logger } from "scheduling/app/logger";
import { replyLanguageName } from "scheduling/app/i18n";
import { buildPrompt, type RequestAccessRole } from "./prompt";
import type { AiTurnResult } from "./types";

function hasStructuredContent(result: AiTurnResult): boolean {
  return result.files.length > 0
    || result.fileWrites.length > 0
    || result.reminders.length > 0
    || result.deliveries.length > 0
    || result.pendingAuthorizations.length > 0
    || result.tasks.length > 0;
}

function looksLikeReminderRequest(text: string): boolean {
  return /(提醒|remind me|set a reminder|remember to)/i.test(text);
}

function hasExplicitPreciseTime(text: string): boolean {
  return /(\b\d{1,2}:\d{2}\b|\b\d{3,4}\b|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}|[上下中]午\s*\d+点|晚上\s*\d+点|早上\s*\d+点|明天\s*\d+点)/i.test(text);
}

function hasVagueReminderTime(text: string): boolean {
  return /(等下|待会|一会|回头|稍后|下午|晚上|早上|中午|later|afternoon|evening|after work|sometime)/i.test(text);
}

function looksLikeTimeClarification(message: string): boolean {
  return /(几点|时间|具体时间|具体几点|什么时间|什么时候|what time|which time)/i.test(message);
}

function looksLikeFreshExternalFactRequest(text: string): boolean {
  return /(今天的?新闻|最新(的)?新闻|current news|latest news|breaking news|天气|weather|股价|price of|比分|score|汇率|exchange rate)/i.test(text);
}

function looksLikeBlockedFreshFactClarification(message: string): boolean {
  return /(无法获取|取不到|没有获取到|请指定新闻来源|请指定.*类型|specify.*source|specify.*category|cannot fetch|unable to get)/i.test(message);
}

function looksLikeMessageDeliveryRequest(text: string): boolean {
  return /(发送.*到|发给|发到|告诉他|告诉她|告诉他们|message (?:the )?(?:group|chat|user)|send .* to|tell them|relay this)/i.test(text);
}

function looksLikePreExecutionDeliveryReply(message: string): boolean {
  return /(正在发送|准备发送|收到指令|我来发送|我来处理.*发送|sending|preparing to send|relay)/i.test(message);
}

function normalizeResponderAnswerMode(userText: string, result: AiTurnResult): AiTurnResult {
  if (hasStructuredContent(result)) return result;
  const message = result.message.trim();
  if (!message) return result;

  if (result.answerMode === "direct") {
    if (looksLikeMessageDeliveryRequest(userText) && looksLikePreExecutionDeliveryReply(message)) {
      return { ...result, answerMode: "needs-execution" };
    }
    if (looksLikeReminderRequest(userText)) {
      if (hasExplicitPreciseTime(userText)) return result;
      if (!hasVagueReminderTime(userText)) return result;
      if (!looksLikeTimeClarification(message)) return result;
      return { ...result, answerMode: "needs-clarification" };
    }
    return result;
  }

  if (result.answerMode === "needs-clarification") {
    if (!looksLikeFreshExternalFactRequest(userText)) return result;
    if (!looksLikeBlockedFreshFactClarification(message)) return result;
    return { ...result, answerMode: "needs-execution" };
  }

  return result;
}

export class StructuredReasoner {
  constructor(
    private config: AppConfig,
    private readonly executePrompt: (promptText: string, attachments: AiAttachment[], scopeKey?: string) => Promise<AiTurnResult>,
    private readonly summarizeAttachments: (attachments: AiAttachment[]) => Array<{ mimeType: string; filename?: string; urlScheme: string }>,
  ) {}

  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  async run(
    text: string,
    uploadedFiles: UploadedFile[] = [],
    attachments: AiAttachment[] = [],
    messageTime?: string,
    accessRole: RequestAccessRole = "allowed",
    scopeKey?: string,
    responderContextText?: string,
    requesterTimezone?: string | null,
  ): Promise<AiTurnResult> {
    const promptText = buildPrompt(
      text,
      uploadedFiles,
      replyLanguageName(this.config),
      this.config.bot.defaultTimezone,
      this.config.bot.personaStyle,
      messageTime,
      accessRole,
      responderContextText,
      requesterTimezone,
    );
    await logger.info(`opencode prompt request attachments=${JSON.stringify(this.summarizeAttachments(attachments))}`);
    const result = await this.executePrompt(promptText, attachments, scopeKey);
    return normalizeResponderAnswerMode(text, result);
  }
}
