import { logger } from "./logger";
import { t } from "./i18n";
import type { AppConfig } from "./types";
import type { OpenCodeService } from "./opencode";
import type { Bot, Context } from "grammy";
import type { ActivePromptTask } from "./prompt_task_runner";

type ReactionCapableApi = Bot<Context>["api"] & {
  setMessageReaction?: (chatId: number, messageId: number, reaction: Array<{ type: "emoji"; emoji: string }>, isBig?: boolean) => Promise<unknown>;
};

export class ActivePromptTasks {
  private readonly tasks = new Map<string, ActivePromptTask>();

  constructor(
    private readonly config: AppConfig,
    private readonly bot: Bot<Context>,
    private readonly opencode: OpenCodeService,
    private readonly stopWaiting: (task: ActivePromptTask) => void,
  ) {}

  hasAny(): boolean {
    return this.tasks.size > 0;
  }

  get(scopeKey: string): ActivePromptTask | undefined {
    return this.tasks.get(scopeKey);
  }

  set(scopeKey: string, task: ActivePromptTask): void {
    this.tasks.set(scopeKey, task);
  }

  deleteIfCurrent(scopeKey: string, taskId: number): void {
    if (this.tasks.get(scopeKey)?.id === taskId) this.tasks.delete(scopeKey);
  }

  isCurrent(scopeKey: string, taskId: number): boolean {
    return this.tasks.get(scopeKey)?.id === taskId;
  }

  async interrupt(reason: string, scopeKey?: string): Promise<void> {
    const keys = scopeKey ? [scopeKey] : Array.from(this.tasks.keys());
    for (const key of keys) {
      const running = this.tasks.get(key);
      if (!running || running.cancelled) continue;
      running.cancelled = true;
      this.stopWaiting(running);
      this.tasks.delete(key);
      await logger.warn(`interrupting active task ${running.id} for ${running.scopeLabel}: ${reason}`);
      await this.opencode.abortCurrentSession(running.scopeKey, running.scopeLabel);
      await this.setReaction(running.chatId, running.sourceMessageId, "😞");
      try {
        await this.bot.api.editMessageText(running.chatId, running.waitingMessageId, t(this.config, "task_interrupted"));
      } catch {
        // ignore message edit failures
      }
    }
  }

  private async setReaction(chatId: number, messageId: number, emoji: string): Promise<void> {
    try {
      const api = this.bot.api as ReactionCapableApi;
      if (!api.setMessageReaction) return;
      await api.setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }], false);
    } catch {
      // ignore reaction failures
    }
  }
}
