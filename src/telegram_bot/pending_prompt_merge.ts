import type { Context } from "grammy";
import { logger } from "./logger";

type PendingTextTask = {
  timer: NodeJS.Timeout;
  ctx: Context;
  waitingTemplate: string;
  promptText: string;
  telegramMessageTime?: string;
  sourceMessageId: number;
  userId?: number;
};

export type PendingPromptText = {
  promptText: string;
  telegramMessageTime?: string;
};

export class PendingPromptMerge {
  private pendingTextTasks = new Map<string, PendingTextTask>();

  constructor(
    private readonly mergeWindowMs: number,
    private readonly startPromptTask: (
      ctx: Context,
      waitingTemplate: string,
      promptText: string,
      telegramMessageTime?: string,
    ) => void,
  ) {}

  schedule(
    scopeKey: string,
    ctx: Context,
    waitingTemplate: string,
    promptText: string,
    telegramMessageTime?: string,
  ): void {
    const sourceMessageId = ctx.message?.message_id;
    if (!sourceMessageId) return;

    this.clear(scopeKey, "replaced by newer text message");
    const timer = setTimeout(() => {
      const pending = this.pendingTextTasks.get(scopeKey);
      if (!pending || pending.sourceMessageId !== sourceMessageId) return;
      this.pendingTextTasks.delete(scopeKey);
      this.startPromptTask(pending.ctx, pending.waitingTemplate, pending.promptText, pending.telegramMessageTime);
    }, this.mergeWindowMs);

    this.pendingTextTasks.set(scopeKey, {
      timer,
      ctx,
      waitingTemplate,
      promptText,
      telegramMessageTime,
      sourceMessageId,
      userId: ctx.from?.id,
    });
  }

  clear(scopeKey: string, reason?: string): void {
    const pending = this.pendingTextTasks.get(scopeKey);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingTextTasks.delete(scopeKey);
    if (reason) void logger.info(`cleared pending text task for ${scopeKey}: ${reason}`);
  }

  consumeForFile(
    scopeKey: string,
    ctx: Context,
    caption: string,
    telegramMessageTime?: string,
    scopeLabel?: string,
  ): PendingPromptText | null {
    const pending = this.pendingTextTasks.get(scopeKey);
    if (!pending) return null;
    if (pending.userId !== ctx.from?.id) return null;

    clearTimeout(pending.timer);
    this.pendingTextTasks.delete(scopeKey);
    void logger.info(`merged pending text task ${pending.sourceMessageId} with file message ${ctx.message?.message_id ?? "unknown"} for ${scopeLabel || scopeKey}`);

    const trimmedCaption = caption.trim();
    const promptText = trimmedCaption
      ? [pending.promptText, "", "Attached message content:", trimmedCaption].join("\n")
      : pending.promptText;

    return {
      promptText,
      telegramMessageTime: pending.telegramMessageTime || telegramMessageTime,
    };
  }
}
