import type { Context } from "grammy";
import type { AppConfig, AiAttachment, UploadedFile } from "scheduling/app/types";
import { logger } from "scheduling/app/logger";
import { saveTelegramFile, uploadedFileToAiAttachment } from "./transport";
import { rememberUploads, touchActivity } from "scheduling/app/state";
import { rememberTelegramParticipants } from "./identity";
import { summarizeIncomingText, telegramReplySummary } from "./reply_context";

export type SavedFileIngress = {
  uploaded: UploadedFile;
  attachment: AiAttachment;
  caption: string;
  messageTime?: string;
};

function fileIngressCaption(ctx: Context): string {
  return ctx.message && "caption" in ctx.message ? ctx.message.caption?.trim() || "" : "";
}

export async function ingestTelegramFile(
  ctx: Context,
  config: AppConfig,
  scopeKey: string,
): Promise<SavedFileIngress | null> {
  const caption = fileIngressCaption(ctx);
  const uploaded = await saveTelegramFile(ctx, config);
  if (!uploaded) return null;

  touchActivity();
  rememberTelegramParticipants(config, ctx);
  await logger.info(`saved incoming file ${uploaded.savedPath}`);

  rememberUploads(scopeKey, [uploaded]);

  const attachment = await uploadedFileToAiAttachment(uploaded);
  return {
    uploaded,
    attachment,
    caption,
  };
}

export async function logFilePromptScheduling(ctx: Context, uploaded: UploadedFile, caption: string): Promise<void> {
  await logger.info(
    `received ${uploaded.source} message chat=${ctx.chat?.id ?? "unknown"} user=${ctx.from?.id ?? "unknown"} message=${ctx.message?.message_id ?? "unknown"} caption=${JSON.stringify(summarizeIncomingText(caption))}${telegramReplySummary(ctx)} and scheduled conversation task`,
  );
}
