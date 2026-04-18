import type { AppConfig } from "bot/app/types";
import { getUserTimezone, state } from "bot/app/state";
import { buildStructuredContextLines, resolveChat, resolveUser } from "bot/operations/context/store";
import { isDisplayableUserText } from "./response";
import { buildPersonaStyleLines } from "./prompt";

export type ReplyComposerInputContext = { requesterUserId?: number; chatId?: number; chatType?: string; preferredLanguage?: string };

export class ReplyComposer {
  constructor(
    private config: AppConfig,
    private readonly promptForText: (text: string) => Promise<string>,
    private readonly promptForStartupText: (text: string) => Promise<string> = promptForText,
  ) {}

  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  async generateStartupGreeting(input?: ReplyComposerInputContext): Promise<string | null> {
    const request = this.buildUserFacingTextRequest([
      "The Telegram bot has just started.",
      "Write one short proactive startup greeting for the administrator.",
      "Return only the greeting text. Do not send it and do not take any action.",
      ...await this.buildStartupGreetingContextLines(input),
    ], { preferredLanguage: input?.preferredLanguage });
    const message = this.extractDirectTextReply(await this.promptForStartupText(request)).trim();
    return message || null;
  }

  async generateScheduleMessage(scheduleText: string, scheduledAt: string, recurrenceDescription: string): Promise<string> {
    const request = this.buildUserFacingTextRequest([
      "Write a short, clear schedule message.",
      `Schedule content: ${scheduleText}`,
      `Scheduled time: ${scheduledAt}`,
      `Repeat rule: ${recurrenceDescription}`,
    ], { preferredLanguage: this.config.bot.language });

    const result = this.extractDirectTextReply(await this.promptForText(request)).trim();
    return result;
  }

  async generateScheduledTaskContent(prompt: string): Promise<string> {
    const request = this.buildUserFacingTextRequest([
      "Generate fresh, useful content for this recurring automated task.",
      `Task prompt: ${prompt}`,
    ]);

    const result = this.extractDirectTextReply(await this.promptForText(request)).trim();
    return result;
  }

  async generateRuntimeAckMessage(kind: "initial" | "progress", input?: ReplyComposerInputContext): Promise<string> {
    const request = this.buildUserFacingTextRequest([
      kind === "initial"
        ? "The assistant has started working on the current request."
        : "The assistant is still working on the current request.",
      kind === "initial"
        ? "Write one very short current-turn acknowledgment for the requester."
        : "Write one very short current-turn progress update for the requester.",
      "Keep it brief and user-facing.",
      "Do not mention tools, commands, internal steps, or implementation details.",
      kind === "initial"
        ? "Do not promise a completion time."
        : "Do not promise a completion time; just say work is still in progress.",
    ], { preferredLanguage: input?.preferredLanguage });

    return this.extractDirectTextReply(await this.promptForText(request)).trim();
  }

  async generateWaitingMessageCandidate(input?: ReplyComposerInputContext): Promise<string> {
    const request = this.buildUserFacingTextRequest([
      "One very short waiting message.",
      "Current turn still running.",
      "Lean hard on the configured persona.",
      "User-facing only.",
      "Do not mention tools or time estimates.",
    ], { preferredLanguage: input?.preferredLanguage });

    return this.extractDirectTextReply(await this.promptForText(request)).trim();
  }

  async generateWaitingMessageCandidates(count: number, input?: ReplyComposerInputContext): Promise<string[]> {
    const target = Math.max(1, Math.min(50, Math.floor(count)));
    const request = this.buildUserFacingTextRequest([
      `Generate ${target} very short waiting messages for a still-running current turn.`,
      "Each line must feel noticeably different in wording.",
      "Vary sentence pattern, wording, punctuation, and rhythm.",
      "Lean hard on the configured persona.",
      "User-facing only.",
      "Do not mention tools or time estimates.",
      "Return exactly one message per line with no numbering, bullets, or commentary.",
    ], { preferredLanguage: input?.preferredLanguage });

    const raw = this.extractDirectTextReply(await this.promptForText(request)).trim();
    return raw.split(/\r?\n+/)
      .map((line) => line.replace(/^[-*\d.\s]+/, "").trim())
      .filter(Boolean)
      .slice(0, target);
  }

  async composeUserReply(baseMessage: string | null | undefined, facts: string[], input?: ReplyComposerInputContext): Promise<string> {
    const cleanFacts = facts.map((item) => item.trim()).filter(Boolean);
    const cleanBase = baseMessage?.trim() || "";
    if (!cleanBase && cleanFacts.length === 0) return "";

    const request = this.buildUserFacingTextRequest([
      ...this.buildRequesterContextLines(input),
      ...this.buildConversationContextLines(input),
      "Reply to the current requester, not to schedule targets or other mentioned users.",
      cleanFacts.length > 0 ? "Use the confirmed facts if relevant and keep the reply concise." : "Rewrite the draft into a natural concise reply.",
      cleanFacts.length > 0 ? "If a schedule was just created, mention the confirmed schedule time and notification timing." : "",
      cleanBase ? `Current draft reply: ${cleanBase}` : "",
      cleanFacts.length > 0 ? "Facts:" : "",
      ...cleanFacts.map((item) => `- ${item}`),
    ], { preferredLanguage: input?.preferredLanguage });

    const composed = this.extractDirectTextReply(await this.promptForText(request)).trim();
    return composed || cleanBase;
  }

  async composeDeliveryMessage(baseMessage: string, recipientLabel: string | undefined): Promise<string> {
    const cleanBase = baseMessage.trim();
    if (!cleanBase) return "";

    const request = this.buildUserFacingTextRequest([
      recipientLabel ? `Recipient label: ${recipientLabel}` : "",
      `Intent or draft content: ${cleanBase}`,
    ]);

    const composed = this.extractDirectTextReply(await this.promptForText(request)).trim();
    return composed || cleanBase;
  }

  private buildUserFacingTextRequest(lines: string[], options?: { separator?: string; includePersonaStyle?: boolean; preferredLanguage?: string }): string {
    const separator = options?.separator ?? "\n";
    const includePersonaStyle = options?.includePersonaStyle ?? true;
    return [
      ...lines,
      options?.preferredLanguage ? `Use this language for the reply: ${options.preferredLanguage}.` : "",
      "Requester metadata is about the user, not the assistant.",
      "Whenever the visible reply mentions a concrete time, date-time, or local clock time, include the timezone explicitly.",
      "Return plain user-visible text only.",
      "Do not output tool calls, tags, hidden markup, or system-control text.",
      ...(includePersonaStyle ? buildPersonaStyleLines(this.config.bot.personaStyle, { label: "Reply style" }) : []),
    ].filter(Boolean).join(separator);
  }

  private async buildStartupGreetingContextLines(input?: ReplyComposerInputContext): Promise<string[]> {
    const requesterUserId = input?.requesterUserId;
    if (typeof requesterUserId !== "number") return [];

    const known = resolveUser(this.config.paths.repoRoot, requesterUserId, { defaultTimezone: this.config.bot.defaultTimezone });
    const runtime = state.telegramUserCache[String(requesterUserId)];
    const profile = known ? {
      id: String(requesterUserId),
      username: known.username || null,
      displayName: known.displayName || null,
      personPath: known.personPath || null,
      timezone: known.timezone || null,
      accessLevel: known.accessLevel || null,
      lastSeenAt: known.lastSeenAt || null,
      updatedAt: known.updatedAt || null,
    } : runtime ? {
      id: String(requesterUserId),
      username: runtime.username || null,
      displayName: runtime.displayName || null,
      timezone: getUserTimezone(requesterUserId)?.trim() || this.config.bot.defaultTimezone || null,
      accessLevel: null,
      lastSeenAt: runtime.lastSeenAt || null,
      updatedAt: null,
    } : {
      id: String(requesterUserId),
    };

    const lines = [
      "Current requester profile JSON:",
      "```json",
      JSON.stringify(profile, null, 2),
      "```",
    ];

    return lines;
  }

  private buildRequesterContextLines(input?: ReplyComposerInputContext): string[] {
    const requesterUserId = input?.requesterUserId;
    if (typeof requesterUserId !== "number") return [];

    const known = resolveUser(this.config.paths.repoRoot, requesterUserId, { defaultTimezone: this.config.bot.defaultTimezone });
    const runtime = state.telegramUserCache[String(requesterUserId)];
    const lines: string[] = [];
    if (known) {
      const name = known.displayName || known.username || String(requesterUserId);
      lines.push(`Current requester: ${name}${known.username ? ` (@${known.username})` : ""}.`);
      if (known.personPath) lines.push(`Requester person file: ${known.personPath}.`);
    } else if (runtime) {
      lines.push(`Current requester: ${runtime.displayName}${runtime.username ? ` (@${runtime.username})` : ""}.`);
    } else {
      lines.push(`Current requester user id: ${requesterUserId}.`);
    }

    const timezone = known?.timezone?.trim() || getUserTimezone(requesterUserId)?.trim() || this.config.bot.defaultTimezone;
    if (timezone) lines.push(`Requester timezone: ${timezone}.`);
    return lines;
  }

  private buildConversationContextLines(input?: ReplyComposerInputContext): string[] {
    const chatId = input?.chatId;
    if (typeof chatId !== "number") return [];

    const known = resolveChat(this.config.paths.repoRoot, chatId);
    const runtime = state.telegramChatCache[String(chatId)];
    const requesterUser = typeof input?.requesterUserId === "number"
      ? resolveUser(this.config.paths.repoRoot, input.requesterUserId, { defaultTimezone: this.config.bot.defaultTimezone })
      : undefined;
    const structured = buildStructuredContextLines(this.config.paths.repoRoot, {
      requesterUserId: input?.requesterUserId,
      requesterUsername: requesterUser?.username || (typeof input?.requesterUserId === "number" ? state.telegramUserCache[String(input.requesterUserId)]?.username : undefined),
      chatId,
      defaultTimezone: this.config.bot.defaultTimezone,
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
    if (!trimmed) return "";
    if (/(<invoke\b|<\/minimax:tool_call>|<tool_call\b|<function_calls?\b)/i.test(trimmed)) return "";
    if (/<\/?[a-z][a-z0-9:_-]*\b[^>]*>/i.test(trimmed)) return "";
    if (/^<[^>]+>[\s\S]*<\/[^>]+>$/.test(trimmed)) return "";
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

    const plain = trimmed.replace(/^"([\s\S]*)"$/, "$1").trim();
    return isDisplayableUserText(plain) ? plain : "";
  }
}
