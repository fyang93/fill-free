import type { Bot, Context } from "grammy";
import { logger } from "scheduling/app/logger";
import type { AiService } from "support/ai";
import type { TaskRecord } from "../store";
import { sendMessageFormatted } from "interaction/telegram/format";

export function taskLogContext(task: TaskRecord): string {
  return `id=${task.id} domain=${task.domain} operation=${task.operation} requester=${task.source?.requesterUserId ?? "unknown"} chat=${task.source?.chatId ?? "unknown"} message=${task.source?.messageId ?? "unknown"}`;
}

export function readTrimmedPayloadString(task: TaskRecord, key: string): string {
  const value = task.payload[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function sendUserReply(
  agentService: AiService,
  bot: Bot<Context>,
  task: TaskRecord,
  draft: string,
): Promise<void> {
  if (!task.source?.chatId) return;
  let userMessage = draft;
  try {
    userMessage = await agentService.composeUserReply(draft, [], {
      requesterUserId: task.source.requesterUserId,
      chatId: task.source.chatId,
    }) || draft;
  } catch (error) {
    await logger.warn(`persona composition failed ${taskLogContext(task)} error=${error instanceof Error ? error.message : String(error)}`);
  }
  await sendMessageFormatted(bot, task.source.chatId, userMessage);
}

export async function sendTaskFailureReply(
  agentService: AiService,
  bot: Bot<Context>,
  task: TaskRecord,
  errorMessage: string,
): Promise<void> {
  if (!task.source?.chatId) return;
  const facts = [
    `A previously accepted background task failed.`,
    `Task: ${task.domain}/${task.operation}.`,
    `Error: ${errorMessage}`,
  ];
  let userMessage = facts.join("\n");
  try {
    userMessage = await agentService.composeUserReply("", facts, {
      requesterUserId: task.source.requesterUserId,
      chatId: task.source.chatId,
    }) || userMessage;
  } catch (error) {
    await logger.warn(`failure reply composition failed ${taskLogContext(task)} error=${error instanceof Error ? error.message : String(error)}`);
  }
  await sendMessageFormatted(bot, task.source.chatId, userMessage);
}
