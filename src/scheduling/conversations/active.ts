import { logger } from "scheduling/app/logger";
import { t } from "scheduling/app/i18n";
import type { AppConfig } from "scheduling/app/types";
import type { AiService } from "support/ai";
import type { Bot, Context } from "grammy";
import type { ActiveConversationTask } from "roles/responder";

type ReactionCapableApi = Bot<Context>["api"] & {
  setMessageReaction?: (chatId: number, messageId: number, reaction: Array<{ type: "emoji"; emoji: string }>, isBig?: boolean) => Promise<unknown>;
};

export class ActiveConversationTasks {
  private readonly tasks = new Map<string, ActiveConversationTask>();

  constructor(
    private readonly config: AppConfig,
    private readonly bot: Bot<Context>,
    private readonly agentService: AiService,
    private readonly stopWaiting: (task: ActiveConversationTask) => void,
  ) {}

  hasAny(): boolean {
    return this.tasks.size > 0;
  }

  get(scopeKey: string): ActiveConversationTask | undefined {
    return this.tasks.get(scopeKey);
  }

  set(scopeKey: string, task: ActiveConversationTask): void {
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
      await this.agentService.abortCurrentSession(running.scopeKey, running.scopeLabel);
      await this.setReaction(running.chatId, running.sourceMessageId, "😞");
      if (typeof running.waitingMessageId === "number") {
        try {
          await this.bot.api.editMessageText(running.chatId, running.waitingMessageId, t(this.config, "task_interrupted"));
        } catch {
          // ignore message edit failures
        }
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
