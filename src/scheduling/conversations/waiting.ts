import type { Bot, Context } from "grammy";
import type { AppConfig } from "scheduling/app/types";
import { WAITING_MESSAGE_PLACEHOLDER } from "./constants";

export type WaitingMessageController = {
  start(task: { id: number; scopeKey: string; chatId: number; waitingMessageId?: number; cancelled: boolean }, waitingTemplate: string, initialWaitingMessage: string): void;
  stop(task: { waitingMessageRotation?: NodeJS.Timeout } | null): void;
  render(template: string, waitingMessage: string): string;
};

export function createWaitingMessageController(
  config: AppConfig,
  bot: Bot<Context>,
  isTaskCurrent: (scopeKey: string, taskId: number) => boolean,
): WaitingMessageController {
  function render(template: string, waitingMessage: string): string {
    return template.includes(WAITING_MESSAGE_PLACEHOLDER)
      ? template.replaceAll(WAITING_MESSAGE_PLACEHOLDER, waitingMessage)
      : waitingMessage;
  }

  function chooseNext(current: string, candidates: string[]): string {
    const filtered = candidates.filter((candidate) => candidate !== current);
    const pool = filtered.length > 0 ? filtered : candidates;
    return pool[Math.floor(Math.random() * pool.length)] || current;
  }

  function start(task: { id: number; scopeKey: string; chatId: number; waitingMessageId?: number; cancelled: boolean; waitingMessageRotation?: NodeJS.Timeout }, waitingTemplate: string, initialWaitingMessage: string): void {
    const candidates = config.telegram.waitingMessageCandidates;
    const waitingMessageId = task.waitingMessageId;
    if (typeof waitingMessageId !== "number" || candidates.length === 0) return;

    let currentWaitingMessage = initialWaitingMessage;
    task.waitingMessageRotation = setInterval(() => {
      if (task.cancelled || !isTaskCurrent(task.scopeKey, task.id)) return;
      const nextWaitingMessage = chooseNext(currentWaitingMessage, candidates);
      if (!nextWaitingMessage || nextWaitingMessage === currentWaitingMessage) return;
      currentWaitingMessage = nextWaitingMessage;
      void bot.api.editMessageText(task.chatId, waitingMessageId, render(waitingTemplate, currentWaitingMessage)).catch(() => {
        // ignore transient edit failures during waiting-message rotation
      });
    }, config.telegram.waitingMessageRotationSeconds * 1000);
  }

  function stop(task: { waitingMessageRotation?: NodeJS.Timeout } | null): void {
    if (!task?.waitingMessageRotation) return;
    clearInterval(task.waitingMessageRotation);
    task.waitingMessageRotation = undefined;
  }

  return { start, stop, render };
}
