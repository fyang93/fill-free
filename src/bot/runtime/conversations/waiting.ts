import type { Bot, Context } from "grammy";
import type { AppConfig } from "bot/app/types";
import { consumeWaitingMessageCandidate } from "bot/runtime/assistant";
import { WAITING_MESSAGE_PLACEHOLDER } from "./constants";

export type WaitingMessageController = {
  start(task: { id: number; scopeKey: string; chatId: number; waitingMessageId?: number; cancelled: boolean }, waitingTemplate: string, initialWaitingMessage: string): void;
  stop(task: { waitingMessageRotation?: NodeJS.Timeout } | null): void;
  render(template: string, waitingMessage: string): string;
};

export function createWaitingMessageController(
  _config: AppConfig,
  _bot: Bot<Context>,
  _isTaskCurrent: (scopeKey: string, taskId: number) => boolean,
): WaitingMessageController {
  function render(template: string, waitingMessage: string): string {
    return template.includes(WAITING_MESSAGE_PLACEHOLDER)
      ? template.replaceAll(WAITING_MESSAGE_PLACEHOLDER, waitingMessage)
      : waitingMessage;
  }

  function start(task: { id: number; scopeKey: string; chatId: number; waitingMessageId?: number; cancelled: boolean; waitingMessageRotation?: NodeJS.Timeout }, waitingTemplate: string, initialWaitingMessage: string): void {
    stop(task);
    if (typeof task.waitingMessageId !== "number") return;
    const rotationSeconds = Math.max(1, _config.telegram.waitingMessageRotationSeconds ?? 5);
    let lastRendered = initialWaitingMessage.trim();
    task.waitingMessageRotation = setInterval(() => {
      void (async () => {
        if (task.cancelled || !_isTaskCurrent(task.scopeKey, task.id) || typeof task.waitingMessageId !== "number") {
          stop(task);
          return;
        }
        const candidate = await consumeWaitingMessageCandidate(_config);
        if (!candidate) return;
        const rendered = render(waitingTemplate, candidate);
        if (!rendered.trim() || rendered === lastRendered) return;
        lastRendered = rendered;
        await _bot.api.editMessageText(task.chatId, task.waitingMessageId, rendered).catch(() => {});
      })();
    }, rotationSeconds * 1000);
  }

  function stop(task: { waitingMessageRotation?: NodeJS.Timeout } | null): void {
    if (!task?.waitingMessageRotation) return;
    clearInterval(task.waitingMessageRotation);
    task.waitingMessageRotation = undefined;
  }

  return { start, stop, render };
}
