import { sendMessageFormatted } from "bot/telegram/format";
import { logger } from "bot/app/logger";
import type { TaskHandler } from "./types";
import { readTrimmedPayloadString } from "./shared";

function logTextContent(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= 500) return JSON.stringify(trimmed);
  return `${JSON.stringify(trimmed.slice(0, 500))}...[truncated chars=${trimmed.length}]`;
}

export const messagesDeliverTaskHandler: TaskHandler = {
  name: "messages.deliver",
  supports: (task) => task.domain === "messages" && task.operation === "deliver",
  run: async ({ bot }, task) => {
    const recipientId = Number(task.payload.recipientId);
    const content = readTrimmedPayloadString(task, "content");
    if (!Number.isInteger(recipientId) || !content) return { result: { skipped: true, reason: "invalid-message-delivery-payload" } };
    const recipientLabel = readTrimmedPayloadString(task, "recipientLabel") || String(recipientId);
    await logger.info(`messages.deliver send recipient=${recipientLabel} scheduled=${typeof task.availableAt === "string" ? "yes" : "no"} chars=${content.length} content=${logTextContent(content)}`);
    await sendMessageFormatted(bot, recipientId, content);
    return { result: { delivered: true, recipientId, recipientLabel, scheduled: typeof task.availableAt === "string" } };
  },
};
