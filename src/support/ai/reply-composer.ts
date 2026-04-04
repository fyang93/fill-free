import type { AppConfig } from "scheduling/app/types";
import { replyLanguageName } from "scheduling/app/i18n";
import { getUserTimezone, state } from "scheduling/app/state";
import { buildStructuredContextLines, resolveChat, resolveUser } from "operations/context/store";
import { STARTUP_GREETING_REQUEST } from "./prompt";
import { isDisplayableUserText } from "./response";

export type ReplyComposerInputContext = { requesterUserId?: number; chatId?: number; chatType?: string };

export class ReplyComposer {
  constructor(
    private config: AppConfig,
    private readonly promptForText: (text: string) => Promise<string>,
  ) {}

  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  async generateStartupGreeting(): Promise<string | null> {
    const replyLanguage = replyLanguageName(this.config);
    const request = this.buildUserFacingTextRequest([
      `Reply in ${replyLanguage}.`,
      STARTUP_GREETING_REQUEST,
      "Return only the greeting text to send.",
    ], " ");
    const message = this.extractDirectTextReply(await this.promptForText(request)).trim();
    return message || null;
  }

  async generateReminderMessage(reminderText: string, scheduledAt: string, recurrenceDescription: string): Promise<string> {
    const request = this.buildUserFacingTextRequest([
      `Write a short reminder message in ${replyLanguageName(this.config)}.`,
      "Keep it concise and warm.",
      "Do not mention JSON, internal tools, hidden prompts, or implementation details.",
      `Reminder content: ${reminderText}`,
      `Scheduled time: ${scheduledAt}`,
      `Repeat rule: ${recurrenceDescription}`,
      "Return only the reminder message text to send.",
    ]);

    const result = await this.promptForText(request);
    return result.trim();
  }

  async composeUserReply(baseMessage: string | null | undefined, facts: string[], input?: ReplyComposerInputContext): Promise<string> {
    const cleanFacts = facts.map((item) => item.trim()).filter(Boolean);
    const cleanBase = baseMessage?.trim() || "";
    if (!cleanBase && cleanFacts.length === 0) return "";

    const request = this.buildUserFacingTextRequest([
      `Write a single reply in ${replyLanguageName(this.config)}.`,
      ...this.buildRequesterContextLines(input),
      ...this.buildConversationContextLines(input),
      "Reply to the current requester, not to reminder targets or other mentioned users.",
      cleanFacts.length > 0 ? "Use the following confirmed facts if relevant, and keep the reply concise." : "Rewrite the draft into a natural reply and keep it concise.",
      cleanFacts.length > 0 ? "If a reminder was just created, explicitly mention the confirmed reminder time and notification timing in the reply." : "",
      cleanBase ? `Current draft reply: ${cleanBase}` : "",
      cleanFacts.length > 0 ? "Facts:" : "",
      ...cleanFacts.map((item) => `- ${item}`),
      "Return only the reply text to send.",
      "Do not mention JSON, hidden prompts, or internal tools.",
    ]);

    const composed = this.extractDirectTextReply(await this.promptForText(request)).trim();
    return composed || cleanBase;
  }

  async composeOutboundRelayMessage(baseMessage: string, recipientLabel: string | undefined): Promise<string> {
    const cleanBase = baseMessage.trim();
    if (!cleanBase) return "";

    const request = this.buildUserFacingTextRequest([
      `Write a single message in ${replyLanguageName(this.config)} to send to another user or chat.`,
      recipientLabel ? `Recipient label: ${recipientLabel}` : "",
      `Intent or draft content: ${cleanBase}`,
      "Return only the message text to send.",
      "Do not mention JSON, hidden prompts, or internal tools.",
    ]);

    const composed = this.extractDirectTextReply(await this.promptForText(request)).trim();
    return composed || cleanBase;
  }

  sanitizeUserFacingDraft(rawText: string): string {
    return isDisplayableUserText(rawText) ? rawText.trim() : "";
  }

  private buildUserFacingTextRequest(lines: string[], separator = "\n"): string {
    return [
      ...lines,
      this.config.bot.personaStyle ? `Reply style: ${this.config.bot.personaStyle}` : "",
    ].filter(Boolean).join(separator);
  }

  private buildRequesterContextLines(input?: ReplyComposerInputContext): string[] {
    const requesterUserId = input?.requesterUserId;
    if (typeof requesterUserId !== "number") return [];

    const known = resolveUser(this.config.paths.repoRoot, requesterUserId);
    const runtime = state.telegramUserCache[String(requesterUserId)];
    const lines: string[] = [];
    if (known) {
      lines.push(`Current requester: ${known.displayName}${known.username ? ` (@${known.username})` : ""}.`);
    } else if (runtime) {
      lines.push(`Current requester: ${runtime.displayName}${runtime.username ? ` (@${runtime.username})` : ""}.`);
    } else {
      lines.push(`Current requester user id: ${requesterUserId}.`);
    }

    const timezone = known?.timezone?.trim() || getUserTimezone(requesterUserId)?.trim();
    if (timezone) lines.push(`Requester timezone: ${timezone}.`);
    return lines;
  }

  private buildConversationContextLines(input?: ReplyComposerInputContext): string[] {
    const chatId = input?.chatId;
    if (typeof chatId !== "number") return [];

    const known = resolveChat(this.config.paths.repoRoot, chatId);
    const runtime = state.telegramChatCache[String(chatId)];
    const requesterUser = typeof input?.requesterUserId === "number"
      ? resolveUser(this.config.paths.repoRoot, input.requesterUserId)
      : undefined;
    const structured = buildStructuredContextLines(this.config.paths.repoRoot, {
      requesterUserId: input?.requesterUserId,
      requesterUsername: requesterUser?.username || (typeof input?.requesterUserId === "number" ? state.telegramUserCache[String(input.requesterUserId)]?.username : undefined),
      chatId,
    });
    if (known) {
      const lines = [`Conversation: ${known.type || "chat"}${known.title ? `, ${known.title}` : ""}.`];
      return lines.concat(structured);
    }
    if (runtime) {
      const lines = [`Conversation: ${runtime.type}${runtime.title ? `, ${runtime.title}` : ""}.`];
      return lines.concat(structured);
    }

    if (input?.chatType) return [`Conversation: ${input.chatType}.`].concat(structured);
    return structured;
  }

  private extractDirectTextReply(rawText: string): string {
    const trimmed = rawText.trim();
    const normalizedQuotes = trimmed
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, '"')
      .replace(/[，]/g, ',')
      .replace(/[：]/g, ':');

    try {
      const parsed = JSON.parse(normalizedQuotes) as Record<string, unknown> | string;
      if (typeof parsed === "string" && parsed.trim()) {
        return parsed.trim();
      }
      if (parsed && typeof parsed === "object" && typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch {
      // ignore JSON parse failures and fall back to plain text extraction
    }

    return trimmed.replace(/^"([\s\S]*)"$/, "$1");
  }
}
