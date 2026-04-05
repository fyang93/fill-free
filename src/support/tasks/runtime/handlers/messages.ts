import { sendMessageFormatted } from "interaction/telegram/format";
import type { TaskHandler } from "./types";
import { readTrimmedPayloadString } from "./shared";

export const messagesDeliverTaskHandler: TaskHandler = {
  name: "messages.deliver",
  supports: (task) => task.domain === "messages" && task.operation === "deliver",
  run: async ({ agentService, bot }, task) => {
    const recipientId = Number(task.payload.recipientId);
    const content = readTrimmedPayloadString(task, "content");
    if (!Number.isInteger(recipientId) || !content) return { result: { skipped: true, reason: "invalid-message-delivery-payload" } };
    const recipientLabel = readTrimmedPayloadString(task, "recipientLabel") || String(recipientId);
    const deliveryText = await agentService.composeDeliveryMessage(content, recipientLabel);
    await sendMessageFormatted(bot, recipientId, deliveryText);
    return { result: { delivered: true, recipientId, recipientLabel, scheduled: typeof task.availableAt === "string" } };
  },
};
