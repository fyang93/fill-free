import { logger } from "bot/app/logger";
import type { AiService } from "bot/ai";
import type { Bot, Context } from "grammy";
import type { ActiveConversationTask } from "bot/runtime/assistant";

export class ActiveConversationTasks {
  private readonly tasks = new Map<string, ActiveConversationTask>();

  constructor(
    private readonly bot: Bot<Context>,
    private readonly agentService: AiService,
    private readonly stopWaiting: (task: ActiveConversationTask) => void,
    private readonly setReaction: (chatId: number, messageId: number, emoji: string) => Promise<void>,
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

  async interrupt(reason: string, scopeKey?: string, options?: { reactionEmoji?: string | null }): Promise<void> {
    const keys = scopeKey ? [scopeKey] : Array.from(this.tasks.keys());
    for (const key of keys) {
      const running = this.tasks.get(key);
      if (!running || running.cancelled) continue;
      running.cancelled = true;
      this.stopWaiting(running);
      this.tasks.delete(key);
      await logger.warn(`interrupting active task ${running.id} for ${running.scopeLabel}: ${reason}`);
      await this.agentService.abortCurrentSession(running.scopeKey, running.scopeLabel);
      if (options?.reactionEmoji) {
        await this.setReaction(running.chatId, running.sourceMessageId, options.reactionEmoji);
      }
      if (typeof running.waitingMessageId === "number") {
        try {
          await this.bot.api.deleteMessage(running.chatId, running.waitingMessageId);
        } catch {
          // ignore waiting-message deletion failures
        }
      }
    }
  }
}
