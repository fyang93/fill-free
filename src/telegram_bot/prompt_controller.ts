import type { Bot, Context } from "grammy";
import type { AppConfig, PromptAttachment, UploadedFile } from "./types";
import { logger } from "./logger";

import { editMessageTextFormatted, replyFormatted } from "./telegram_format";
import { getAccurateNowIso } from "./time";
import {
  clearRecentUploads,
  persistState,
  touchActivity,
} from "./state";
import { t } from "./i18n";
import { accessLevelForUserId } from "./access";
import type { AgentService } from "./agent";
import { runPromptTask, type ActivePromptTask } from "./prompt_task_runner";
import { WAITING_MESSAGE_PLACEHOLDER } from "./prompt_constants";
import { createWaitingMessageController } from "./prompt_task_runtime";
import { rememberTelegramParticipants } from "./telegram_identity";
import { buildTelegramReplyContextPrompt, summarizeIncomingText, telegramReplySummary } from "./reply_context";
import { PendingPromptMerge } from "./pending_prompt_merge";
import { ingestTelegramFile, logFilePromptScheduling } from "./file_ingress";
import { ActivePromptTasks } from "./active_prompt_tasks";
import { buildRecentAttachments, pruneRecentUploads } from "./recent_uploads";

type PromptControllerDeps = {
  config: AppConfig;
  bot: Bot<Context>;
  agentService: AgentService;
  isTrustedUserId: (userId: number | undefined) => boolean;
  isAdminUserId: (userId: number | undefined) => boolean;
  isAddressedToBot: (ctx: Context) => boolean;
};

type ReactionCapableApi = Bot<Context>["api"] & {
  setMessageReaction?: (chatId: number, messageId: number, reaction: Array<{ type: "emoji"; emoji: string }>, isBig?: boolean) => Promise<unknown>;
};

const TEXT_ATTACHMENT_MERGE_WINDOW_MS = 1200;

function isConfigMutationRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const targets = ["config.toml", " config ", "配置", "设定", "settings", "runtime config", "bot config"];
  const actions = ["修改", "更改", "改", "调整", "更新", "设置", "set ", "change ", "update ", "edit ", "rewrite ", "patch ", "tweak "];
  return targets.some((item) => normalized.includes(item)) && actions.some((item) => normalized.includes(item));
}

function contactPromptText(ctx: Context): string {
  const contact = ctx.message && "contact" in ctx.message ? ctx.message.contact : undefined;
  if (!contact) return "";
  const replyContext = buildTelegramReplyContextPrompt(ctx);
  return [
    "The user shared a Telegram contact card.",
    replyContext,
    `First name: ${contact.first_name}`,
    contact.last_name ? `Last name: ${contact.last_name}` : "",
    `Phone number: ${contact.phone_number}`,
    typeof contact.user_id === "number" ? `Telegram user id: ${contact.user_id}` : "",
    contact.vcard ? `vCard: ${contact.vcard}` : "",
    "Use this contact information and any reply context when answering or updating memory.",
  ].filter(Boolean).join("\n");
}

export class PromptController {
  private nextTaskId = 1;
  private readonly waiting;
  private readonly pendingMerge;
  private readonly activeTasks;

  constructor(private readonly deps: PromptControllerDeps) {
    this.waiting = createWaitingMessageController(
      this.deps.config,
      this.deps.bot,
      (scopeKey, taskId) => this.activeTasks.isCurrent(scopeKey, taskId),
    );
    this.pendingMerge = new PendingPromptMerge(
      TEXT_ATTACHMENT_MERGE_WINDOW_MS,
      (ctx, waitingTemplate, promptText, telegramMessageTime) => {
        this.startPromptTask(ctx, waitingTemplate, promptText, [], [], telegramMessageTime);
      },
    );
    this.activeTasks = new ActivePromptTasks(
      this.deps.config,
      this.deps.bot,
      this.deps.agentService,
      (task) => this.waiting.stop(task),
    );
  }

  hasActiveTask(): boolean {
    return this.activeTasks.hasAny();
  }

  async setReactionSafe(ctx: Context, emoji: string): Promise<void> {
    const messageId = ctx.message?.message_id;
    const chatId = ctx.chat?.id;
    if (!messageId || !chatId) return;
    await this.setReactionByMessageSafe(chatId, messageId, emoji);
  }

  async setReactionByMessageSafe(chatId: number, messageId: number, emoji: string): Promise<void> {
    try {
      const api = this.deps.bot.api as ReactionCapableApi;
      if (!api.setMessageReaction) return;
      await api.setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }], false);
    } catch {
      // ignore reaction failures
    }
  }

  private conversationScope(ctx: Context): { key: string; label: string } {
    const chat = ctx.chat;
    const userId = ctx.from?.id;
    if (chat?.type === "group" || chat?.type === "supergroup") {
      const title = "title" in chat && typeof chat.title === "string" && chat.title.trim() ? chat.title.trim() : `chat ${chat.id}`;
      return { key: `chat:${chat.id}`, label: `group ${title}` };
    }
    if (typeof userId === "number") return { key: `user:${userId}`, label: `user ${userId}` };
    return { key: "global", label: "global" };
  }

  async interruptActiveTask(reason: string, scopeKey?: string): Promise<void> {
    await this.activeTasks.interrupt(reason, scopeKey);
  }

  async editMessageTextFormattedSafe(ctx: Context, chatId: number, messageId: number, text: string, options?: { reply_markup?: unknown }): Promise<void> {
    try {
      await editMessageTextFormatted(ctx, chatId, messageId, text, options as Parameters<typeof editMessageTextFormatted>[4]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/message is not modified|400: Bad Request/i.test(message)) return;
      throw error;
    }
  }

  async handleIncomingText(ctx: Context): Promise<void> {
    try {
      const text = ctx.message && "text" in ctx.message ? ctx.message.text?.trim() || "" : "";
      if (!text || text.startsWith("/")) return;
      if (!this.deps.isAddressedToBot(ctx)) return;

      if (isConfigMutationRequest(text) && !this.deps.isAdminUserId(ctx.from?.id)) {
        await replyFormatted(ctx, t(this.deps.config, "config_mutation_admin_only"));
        await this.setReactionSafe(ctx, "😞");
        return;
      }

      touchActivity();
      if (rememberTelegramParticipants(this.deps.config, ctx)) {
        await persistState(this.deps.config.paths.stateFile);
      }
      const scope = this.conversationScope(ctx);
      const { files: validRecentUploads, attachments } = await buildRecentAttachments(scope.key);
      const telegramMessageTime = await this.messageReferenceTime(ctx);
      const replyContext = this.repliedMessageContext(ctx);
      const effectiveText = replyContext
        ? [
            "Current user message:",
            text,
            "",
            replyContext,
          ].join("\n")
        : text;
      await logger.info(`received text message chat=${ctx.chat?.id ?? "unknown"} chatType=${ctx.chat?.type ?? "unknown"} user=${ctx.from?.id ?? "unknown"} message=${ctx.message?.message_id ?? "unknown"} text=${JSON.stringify(summarizeIncomingText(text))}${telegramReplySummary(ctx)} replyContextIncluded=${replyContext ? "yes" : "no"}`);
      if (validRecentUploads.length === 0 && attachments.length === 0) {
        this.pendingMerge.schedule(scope.key, ctx, WAITING_MESSAGE_PLACEHOLDER, effectiveText, telegramMessageTime);
        return;
      }
      this.startPromptTask(ctx, WAITING_MESSAGE_PLACEHOLDER, effectiveText, validRecentUploads, attachments, telegramMessageTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.error(`text handling failed: ${message}`);
      await replyFormatted(ctx, t(this.deps.config, "task_failed", { error: message }));
      await this.setReactionSafe(ctx, "😞");
    }
  }

  async handleIncomingContact(ctx: Context): Promise<void> {
    if (this.deps.isAddressedToBot && !this.deps.isAddressedToBot(ctx) && ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) return;

    try {
      const promptText = contactPromptText(ctx);
      if (!promptText) return;
      touchActivity();
      if (rememberTelegramParticipants(this.deps.config, ctx)) {
        await persistState(this.deps.config.paths.stateFile);
      }
      const telegramMessageTime = await this.messageReferenceTime(ctx);
      const contact = ctx.message && "contact" in ctx.message ? ctx.message.contact : undefined;
      await logger.info(`received contact message chat=${ctx.chat?.id ?? "unknown"} user=${ctx.from?.id ?? "unknown"} message=${ctx.message?.message_id ?? "unknown"} firstName=${JSON.stringify(contact?.first_name || "")} lastName=${JSON.stringify(contact?.last_name || "")} phoneNumber=${JSON.stringify(contact?.phone_number || "")} contactUserId=${contact?.user_id ?? "unknown"}${telegramReplySummary(ctx)}`);
      this.startPromptTask(ctx, WAITING_MESSAGE_PLACEHOLDER, promptText, [], [], telegramMessageTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.error(`contact handling failed: ${message}`);
      await replyFormatted(ctx, t(this.deps.config, "task_failed", { error: message }));
      await this.setReactionSafe(ctx, "😞");
    }
  }

  async handleIncomingFile(ctx: Context): Promise<void> {
    const caption = ctx.message && "caption" in ctx.message ? ctx.message.caption?.trim() || "" : "";
    if (this.deps.isAddressedToBot && !this.deps.isAddressedToBot(ctx) && ctx.chat && (ctx.chat.type === "group" || ctx.chat.type === "supergroup")) return;

    const accessLevel = accessLevelForUserId(this.deps.config, ctx.from?.id);
    if (accessLevel !== "trusted") {
      await logger.warn(`Telegram file upload rejected level=${accessLevel} user=${ctx.from?.id ?? "unknown"}`);
      await this.setReactionSafe(ctx, "😞");
      await replyFormatted(ctx, t(this.deps.config, "file_upload_not_allowed"));
      return;
    }

    try {
      if (caption && isConfigMutationRequest(caption) && !this.deps.isAdminUserId(ctx.from?.id)) {
        await replyFormatted(ctx, t(this.deps.config, "config_mutation_admin_only"));
        await this.setReactionSafe(ctx, "😞");
        return;
      }

      const scope = this.conversationScope(ctx);
      const saved = await ingestTelegramFile(ctx, this.deps.config, scope.key);
      if (!saved) return;
      const { uploaded, attachment } = saved;

      if (!caption) {
        const mergedPending = this.pendingMerge.consumeForFile(scope.key, ctx, "", await this.messageReferenceTime(ctx), scope.label);
        if (mergedPending) {
          this.startPromptTask(ctx, WAITING_MESSAGE_PLACEHOLDER, mergedPending.promptText, [uploaded], [attachment], mergedPending.telegramMessageTime);
          return;
        }
        await this.setReactionSafe(ctx, "🥰");
        await replyFormatted(ctx, t(this.deps.config, "file_saved", { path: uploaded.savedPath, waiting_message: this.deps.config.bot.waitingMessage }));
        return;
      }

      const waitingTemplate = WAITING_MESSAGE_PLACEHOLDER;
      const telegramMessageTime = await this.messageReferenceTime(ctx);

      await logFilePromptScheduling(ctx, uploaded, caption);
      const mergedPending = this.pendingMerge.consumeForFile(scope.key, ctx, caption, telegramMessageTime, scope.label);
      if (mergedPending) {
        this.startPromptTask(ctx, waitingTemplate, mergedPending.promptText, [uploaded], [attachment], mergedPending.telegramMessageTime);
        return;
      }
      this.startPromptTask(ctx, waitingTemplate, caption, [uploaded], [attachment], telegramMessageTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.error(`file handling failed: ${message}`);
      await replyFormatted(ctx, t(this.deps.config, "file_processing_failed", { error: message }));
      await this.setReactionSafe(ctx, "😞");
    }
  }

  async resetSession(ctx: Context): Promise<string> {
    const scope = this.conversationScope(ctx);
    this.pendingMerge.clear(scope.key, "/new command");
    await this.interruptActiveTask("/new command", scope.key);
    const sessionId = await this.deps.agentService.newSession(scope.key, scope.label);
    clearRecentUploads(scope.key);
    return sessionId;
  }

  private repliedMessageContext(ctx: Context): string {
    return buildTelegramReplyContextPrompt(ctx);
  }

  private async messageReferenceTime(ctx: Context): Promise<string> {
    const unixSeconds = ctx.message?.date;
    if (typeof unixSeconds === "number") return new Date(unixSeconds * 1000).toISOString();
    return getAccurateNowIso();
  }

  private startPromptTask(
    ctx: Context,
    waitingTemplate: string,
    promptText: string,
    uploadedFiles: UploadedFile[] = [],
    attachments: PromptAttachment[] = [],
    telegramMessageTime?: string,
  ): void {
    void this.runPromptTask(ctx, waitingTemplate, promptText, uploadedFiles, attachments, telegramMessageTime).catch(async (error) => {
      await logger.error(`background prompt task crashed: ${error instanceof Error ? error.stack || error.message : String(error)}`);
    });
  }

  private async runPromptTask(
    ctx: Context,
    waitingTemplate: string,
    promptText: string,
    uploadedFiles: UploadedFile[] = [],
    attachments: PromptAttachment[] = [],
    telegramMessageTime?: string,
  ): Promise<void> {
    const chatId = ctx.chat?.id;
    const sourceMessageId = ctx.message?.message_id;
    const userId = ctx.from?.id;
    const scope = this.conversationScope(ctx);
    if (!chatId || !sourceMessageId) return;

    this.pendingMerge.clear(scope.key);
    await this.interruptActiveTask(`new incoming message ${sourceMessageId}`, scope.key);
    await this.setReactionSafe(ctx, "🤔");
    const initialWaitingMessage = this.deps.config.bot.waitingMessage;
    const waiting = await ctx.reply(this.waiting.render(waitingTemplate, initialWaitingMessage));
    const task: ActivePromptTask = {
      id: this.nextTaskId++,
      userId,
      scopeKey: scope.key,
      scopeLabel: scope.label,
      chatId,
      sourceMessageId,
      waitingMessageId: waiting.message_id,
      cancelled: false,
    };
    this.activeTasks.set(scope.key, task);
    this.waiting.start(task, waitingTemplate, initialWaitingMessage);

    try {
      await runPromptTask({
        config: this.deps.config,
        bot: this.deps.bot,
        ctx,
        task,
        promptText,
        uploadedFiles,
        attachments,
        telegramMessageTime,
        agentService: this.deps.agentService,
        isAdminUserId: this.deps.isAdminUserId,
        isTrustedUserId: this.deps.isTrustedUserId,
        isTaskCurrent: (taskScopeKey, taskId) => this.activeTasks.isCurrent(taskScopeKey, taskId),
        onPruneRecentUploads: (taskScopeKey) => pruneRecentUploads(taskScopeKey),
        onStopWaiting: (runningTask) => this.waiting.stop(runningTask),
        onSetReaction: (reactionCtx, emoji) => this.setReactionSafe(reactionCtx, emoji),
      });
    } finally {
      this.activeTasks.deleteIfCurrent(scope.key, task.id);
    }
  }
}
