import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "scheduling/app/types";
import { replyLanguageName } from "scheduling/app/i18n";
import { getUserTimezone, state } from "scheduling/app/state";
import { buildStructuredContextLines, resolveChat, resolveUser } from "operations/context/store";
import { isDisplayableUserText } from "./response";

export type ReplyComposerInputContext = { requesterUserId?: number; chatId?: number; chatType?: string };

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
    const replyLanguage = replyLanguageName(this.config);
    const request = this.buildUserFacingTextRequest([
      `Reply in ${replyLanguage}.`,
      ...await this.buildStartupGreetingContextLines(input),
    ], { includePersonaStyle: false });
    const message = this.extractDirectTextReply(await this.promptForStartupText(request)).trim();
    return message || null;
  }

  async generateReminderMessage(reminderText: string, scheduledAt: string, recurrenceDescription: string): Promise<string> {
    const request = this.buildUserFacingTextRequest([
      `Write a short reminder message in ${replyLanguageName(this.config)}.`,
      "Keep it concise, plain, and useful.",
      "Use one short sentence, or two short sentences only if necessary.",
      "State the reminder content and the relevant time clearly.",
      "Do not use roleplay, sound effects, pet names, cutesy affectations, stage directions, emoji, or decorative formatting.",
      "Do not add extra commentary, warnings, greetings, apologies, or sign-offs.",
      "Do not mention JSON, internal tools, hidden prompts, or implementation details.",
      `Reminder content: ${reminderText}`,
      `Scheduled time: ${scheduledAt}`,
      `Repeat rule: ${recurrenceDescription}`,
      "Return only the reminder message text to send.",
      "Return plain user-visible text only. Do not output tool calls, XML tags, invoke blocks, markdown fences, or hidden markup.",
    ], { includePersonaStyle: false });

    const result = this.extractDirectTextReply(await this.promptForText(request)).trim();
    return result;
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
      "Do not mention JSON, hidden prompts, internal tools, internal file paths, or raw operation labels.",
      "Return plain user-visible text only. Do not output tool calls, XML tags, invoke blocks, markdown fences, or hidden markup.",
    ]);

    const composed = this.extractDirectTextReply(await this.promptForText(request)).trim();
    return composed || cleanBase;
  }

  async composeExecutionCallbackReply(previousReply: string, facts: string[], input?: ReplyComposerInputContext): Promise<string> {
    const cleanFacts = facts.map((item) => item.trim()).filter(Boolean);
    if (cleanFacts.length === 0) return "";

    const request = this.buildUserFacingTextRequest([
      `Write one optional follow-up callback reply in ${replyLanguageName(this.config)}.`,
      ...this.buildRequesterContextLines(input),
      ...this.buildConversationContextLines(input),
      "Use the execution facts only to correct, confirm, or complete the previous assistant reply.",
      "Only send a callback if the execution facts materially correct, complete, or change the previous reply.",
      "If the previous reply already adequately answers the user and the execution facts do not materially add or change anything, return an empty string.",
      "Keep the callback to one short plain sentence unless two short sentences are strictly necessary.",
      "Do not repeat the same answer, restate the same list, add optional suggestions, ask a new question, or add extra commentary unless the execution facts require it.",
      "Do not use roleplay, pet names, sound effects, cutesy affectations, stage directions, markdown emphasis, emoji, or decorative formatting.",
      "Do not mention system status, queues, scans, processing, completion banners, or internal confirmation unless those are explicit user-relevant facts.",
      previousReply.trim() ? `Previous assistant reply: ${previousReply.trim()}` : "",
      "Execution facts:",
      ...cleanFacts.map((item) => `- ${item}`),
      "Return only the callback reply text (or empty string).",
      "Do not mention JSON, hidden prompts, or internal tools.",
      "Return plain user-visible text only. Do not output tool calls, XML tags, invoke blocks, markdown fences, or hidden markup.",
    ], { includePersonaStyle: false });

    return this.extractDirectTextReply(await this.promptForText(request)).trim();
  }

  async composeDeliveryMessage(baseMessage: string, recipientLabel: string | undefined): Promise<string> {
    const cleanBase = baseMessage.trim();
    if (!cleanBase) return "";

    const request = this.buildUserFacingTextRequest([
      `Write a single message in ${replyLanguageName(this.config)} to send to another user or chat.`,
      recipientLabel ? `Recipient label: ${recipientLabel}` : "",
      `Intent or draft content: ${cleanBase}`,
      "Return only the message text to send.",
      "Do not mention JSON, hidden prompts, or internal tools.",
      "Return plain user-visible text only. Do not output tool calls, XML tags, invoke blocks, markdown fences, or hidden markup.",
    ]);

    const composed = this.extractDirectTextReply(await this.promptForText(request)).trim();
    return composed || cleanBase;
  }

  sanitizeUserFacingDraft(rawText: string): string {
    return isDisplayableUserText(rawText) ? rawText.trim() : "";
  }

  private buildUserFacingTextRequest(lines: string[], options?: { separator?: string; includePersonaStyle?: boolean }): string {
    const separator = options?.separator ?? "\n";
    const includePersonaStyle = options?.includePersonaStyle ?? true;
    return [
      ...lines,
      "The output must be plain user-visible text only.",
      "Never output tool calls, XML tags, invoke blocks, hidden markup, or system-control text.",
      includePersonaStyle && this.config.bot.personaStyle ? `Reply style: ${this.config.bot.personaStyle}` : "",
    ].filter(Boolean).join(separator);
  }

  private async buildStartupGreetingContextLines(input?: ReplyComposerInputContext): Promise<string[]> {
    const requesterUserId = input?.requesterUserId;
    if (typeof requesterUserId !== "number") return [];

    const known = resolveUser(this.config.paths.repoRoot, requesterUserId);
    const runtime = state.telegramUserCache[String(requesterUserId)];
    const profile = known ? {
      id: String(requesterUserId),
      username: known.username || null,
      displayName: known.displayName || null,
      timezone: known.timezone || null,
      memoryPath: known.memoryPath || null,
      role: known.role || null,
      lastSeenAt: known.lastSeenAt || null,
      updatedAt: known.updatedAt || null,
    } : runtime ? {
      id: String(requesterUserId),
      username: runtime.username || null,
      displayName: runtime.displayName || null,
      timezone: getUserTimezone(requesterUserId)?.trim() || null,
      memoryPath: null,
      role: null,
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

    const memoryFile = await this.loadMarkdownFile(known?.memoryPath);
    if (memoryFile) {
      lines.push(`Current requester memory file: ${memoryFile.path}`);
      lines.push("```md");
      lines.push(memoryFile.content);
      lines.push("```");
    }

    return lines;
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

  private async loadMarkdownFile(memoryPath: string | undefined): Promise<{ path: string; content: string } | null> {
    if (!memoryPath) return null;
    try {
      const absolutePath = path.join(this.config.paths.repoRoot, memoryPath);
      const raw = await readFile(absolutePath, "utf8");
      const content = raw.trim();
      if (!content) return null;
      return {
        path: memoryPath,
        content: content.length > 4000 ? `${content.slice(0, 4000)}\n\n...[truncated]` : content,
      };
    } catch {
      return null;
    }
  }

  private extractDirectTextReply(rawText: string): string {
    const trimmed = rawText.trim();
    if (!trimmed) return "";
    if (/(<invoke\b|<\/minimax:tool_call>|<tool_call\b|<function_calls?\b)/i.test(trimmed)) return "";
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
