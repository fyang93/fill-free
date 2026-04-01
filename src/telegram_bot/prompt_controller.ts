import { stat } from "node:fs/promises";
import type { Bot, Context } from "grammy";
import type { AppConfig, PromptAttachment, UploadedFile } from "./types";
import { logger } from "./logger";
import { saveTelegramFile, uploadedFileToAttachment } from "./files";
import { editMessageTextFormatted, replyFormatted } from "./telegram_format";
import { getAccurateNowIso } from "./time";
import {
  clearRecentUploads,
  getRecentUploads,
  hasRecentUploads,
  rememberUploads,
  persistState,
  retainRecentUploads,
  touchActivity,
} from "./state";
import { t } from "./i18n";
import { accessLevelForUserId } from "./access";
import type { OpenCodeService } from "./opencode";
import { executePromptActions } from "./prompt_actions";
import { WAITING_MESSAGE_PLACEHOLDER } from "./prompt_constants";
import { createWaitingMessageController, deliverPromptOutputs } from "./prompt_task_runtime";
import { buildTelegramPromptContext, rememberTelegramParticipants } from "./telegram_identity";

type ActiveTask = {
  id: number;
  userId?: number;
  scopeKey: string;
  scopeLabel: string;
  chatId: number;
  sourceMessageId: number;
  waitingMessageId: number;
  cancelled: boolean;
  waitingMessageRotation?: NodeJS.Timeout;
};

type PromptControllerDeps = {
  config: AppConfig;
  bot: Bot<Context>;
  opencode: OpenCodeService;
  isTrustedUserId: (userId: number | undefined) => boolean;
  isAdminUserId: (userId: number | undefined) => boolean;
  isAddressedToBot: (ctx: Context) => boolean;
};

type ReactionCapableApi = Bot<Context>["api"] & {
  setMessageReaction?: (chatId: number, messageId: number, reaction: Array<{ type: "emoji"; emoji: string }>, isBig?: boolean) => Promise<unknown>;
};

function isConfigMutationRequest(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (!normalized) return false;
  const targets = ["config.toml", " config ", "配置", "设定", "settings", "runtime config", "bot config"];
  const actions = ["修改", "更改", "改", "调整", "更新", "设置", "set ", "change ", "update ", "edit ", "rewrite ", "patch ", "tweak "];
  return targets.some((item) => normalized.includes(item)) && actions.some((item) => normalized.includes(item));
}

export class PromptController {
  private activeTasks = new Map<string, ActiveTask>();
  private nextTaskId = 1;
  private readonly waiting;

  constructor(private readonly deps: PromptControllerDeps) {
    this.waiting = createWaitingMessageController(
      this.deps.config,
      this.deps.bot,
      (scopeKey, taskId) => this.activeTasks.get(scopeKey)?.id === taskId,
    );
  }

  hasActiveTask(): boolean {
    return this.activeTasks.size > 0;
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
    const keys = scopeKey ? [scopeKey] : Array.from(this.activeTasks.keys());
    for (const key of keys) {
      const running = this.activeTasks.get(key);
      if (!running || running.cancelled) continue;
      running.cancelled = true;
      this.waiting.stop(running);
      this.activeTasks.delete(key);
      await logger.warn(`interrupting active task ${running.id} for ${running.scopeLabel}: ${reason}`);
      await this.deps.opencode.abortCurrentSession(running.scopeKey, running.scopeLabel);
      await this.setReactionByMessageSafe(running.chatId, running.sourceMessageId, "😞");
      try {
        await this.deps.bot.api.editMessageText(running.chatId, running.waitingMessageId, t(this.deps.config, "task_interrupted"));
      } catch {
        // ignore message edit failures
      }
    }
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
      const recentUploads = getRecentUploads(scope.key);
      const { files: validRecentUploads, attachments } = await this.buildRecentAttachments(scope.key, recentUploads);
      const telegramMessageTime = await this.messageReferenceTime(ctx);
      await logger.info(`received text message ${ctx.message?.message_id} and scheduled prompt task`);
      this.startPromptTask(ctx, WAITING_MESSAGE_PLACEHOLDER, text, validRecentUploads, attachments, telegramMessageTime);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.error(`text handling failed: ${message}`);
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

      const uploaded = await saveTelegramFile(ctx, this.deps.config);
      if (!uploaded) return;

      touchActivity();
      if (rememberTelegramParticipants(this.deps.config, ctx)) {
        await persistState(this.deps.config.paths.stateFile);
      }
      await logger.info(`saved telegram file ${uploaded.savedPath}`);
      const scope = this.conversationScope(ctx);
      rememberUploads(scope.key, [uploaded]);

      if (!caption) {
        await this.setReactionSafe(ctx, "🥰");
        await replyFormatted(ctx, t(this.deps.config, "file_saved", { path: uploaded.savedPath, waiting_message: this.deps.config.telegram.waitingMessage }));
        return;
      }

      const attachment = await uploadedFileToAttachment(uploaded);
      const waitingTemplate = t(this.deps.config, "file_saved_and_processing", { path: uploaded.savedPath, waiting_message: WAITING_MESSAGE_PLACEHOLDER });
      const telegramMessageTime = await this.messageReferenceTime(ctx);

      await logger.info(`received ${uploaded.source} message ${ctx.message?.message_id} with caption and scheduled prompt task`);
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
    await this.interruptActiveTask("/new command", scope.key);
    const sessionId = await this.deps.opencode.newSession(scope.key, scope.label);
    clearRecentUploads(scope.key);
    return sessionId;
  }

  private async messageReferenceTime(ctx: Context): Promise<string> {
    const unixSeconds = ctx.message?.date;
    if (typeof unixSeconds === "number") return new Date(unixSeconds * 1000).toISOString();
    return getAccurateNowIso();
  }

  private async buildRecentAttachments(scopeKey: string, files: UploadedFile[]): Promise<{ files: UploadedFile[]; attachments: PromptAttachment[] }> {
    const settled = await Promise.allSettled(
      files.map(async (file) => ({
        file,
        attachment: file.source === "voice" || file.source === "audio" ? null : await uploadedFileToAttachment(file),
      })),
    );

    const validFiles: UploadedFile[] = [];
    const attachments: PromptAttachment[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") {
        validFiles.push(result.value.file);
        if (result.value.attachment) attachments.push(result.value.attachment);
        continue;
      }
      await logger.warn(`skipping missing recent upload: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
    }

    if (validFiles.length !== files.length) retainRecentUploads(scopeKey, validFiles);
    return { files: validFiles, attachments };
  }

  private async pruneRecentUploads(scopeKey: string): Promise<void> {
    if (!hasRecentUploads(scopeKey)) return;
    const recentUploads = getRecentUploads(scopeKey);
    const settled = await Promise.allSettled(recentUploads.map(async (file) => {
      await stat(file.absolutePath);
      return file;
    }));

    const validFiles: UploadedFile[] = [];
    for (const result of settled) {
      if (result.status === "fulfilled") validFiles.push(result.value);
    }

    if (validFiles.length !== recentUploads.length) {
      retainRecentUploads(scopeKey, validFiles);
      await logger.info(`pruned stale recent uploads: ${recentUploads.length - validFiles.length} removed`);
    }
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

    await this.interruptActiveTask(`new incoming message ${sourceMessageId}`, scope.key);
    await this.setReactionSafe(ctx, "🤔");
    const initialWaitingMessage = this.deps.config.telegram.waitingMessage;
    const waiting = await ctx.reply(this.waiting.render(waitingTemplate, initialWaitingMessage));
    const task: ActiveTask = {
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
      const accessRole = this.deps.isAdminUserId(userId) ? "admin" : this.deps.isTrustedUserId(userId) ? "trusted" : "allowed";
      const telegramPromptContext = buildTelegramPromptContext(this.deps.config, ctx);
      const effectivePromptText = telegramPromptContext ? `${promptText}\n\n${telegramPromptContext}` : promptText;
      const answer = await this.deps.opencode.prompt(effectivePromptText, uploadedFiles, attachments, telegramMessageTime, scope.key, scope.label, accessRole);
      if (task.cancelled || this.activeTasks.get(scope.key)?.id !== task.id) {
        await logger.warn(`discarding stale prompt result for task ${task.id}`);
        return;
      }

      this.waiting.stop(task);
      const actionResult = await executePromptActions({
        config: this.deps.config,
        bot: this.deps.bot,
        opencode: this.deps.opencode,
        answer,
        ctx,
        requesterUserId: userId,
        telegramMessageTime,
        canDeliverOutbound: this.deps.isTrustedUserId(userId) || this.deps.isAdminUserId(userId),
        accessRole,
      });
      const modelFacts = actionResult.facts;
      let finalMessage = answer.message || t(this.deps.config, "generic_done");
      if (modelFacts.length > 0) {
        try {
          finalMessage = await this.deps.opencode.composeTelegramReply(finalMessage, modelFacts);
        } catch (error) {
          await logger.warn(`failed to compose telegram follow-up reply: ${error instanceof Error ? error.message : String(error)}`);
          finalMessage = [finalMessage, ...modelFacts].filter(Boolean).join("\n\n");
        }
      }
      if (actionResult.replyAppendix) {
        finalMessage = [finalMessage, actionResult.replyAppendix].filter(Boolean).join("\n\n");
      }
      await editMessageTextFormatted(ctx, chatId, waiting.message_id, finalMessage);

      await deliverPromptOutputs(ctx, this.deps.config, answer);

      await this.pruneRecentUploads(scope.key);
      await this.setReactionSafe(ctx, "🥰");
    } catch (error) {
      if (task.cancelled || this.activeTasks.get(scope.key)?.id !== task.id) {
        await logger.warn(`ignored prompt failure from cancelled task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      this.waiting.stop(task);
      const message = error instanceof Error ? error.message : String(error);
      await logger.error(`prompt handling failed: ${message}`);
      await this.pruneRecentUploads(scope.key);
      await editMessageTextFormatted(ctx, chatId, waiting.message_id, t(this.deps.config, "task_failed", { error: message }));
      await this.setReactionSafe(ctx, "😞");
    } finally {
      this.waiting.stop(task);
      if (this.activeTasks.get(scope.key)?.id === task.id) this.activeTasks.delete(scope.key);
    }
  }
}
