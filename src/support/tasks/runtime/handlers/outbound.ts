import { sendMessageFormatted } from "interaction/telegram/format";
import type { TaskHandler } from "./types";
import { readTrimmedPayloadString } from "./shared";

export const outboundSendTaskHandler: TaskHandler = {
  name: "outbound.send",
  supports: (task) => task.domain === "outbound" && task.operation === "send",
  run: async ({ agentService, bot }, task) => {
    const recipientId = Number(task.payload.recipientId);
    const text = readTrimmedPayloadString(task, "message");
    if (!Number.isInteger(recipientId) || !text) return { result: { skipped: true, reason: "invalid-outbound-payload" } };
    const recipientLabel = readTrimmedPayloadString(task, "recipientLabel") || String(recipientId);
    const relayText = await agentService.composeOutboundRelayMessage(text, recipientLabel);
    await sendMessageFormatted(bot, recipientId, relayText);
    return { result: { delivered: true, recipientId, recipientLabel } };
  },
};
