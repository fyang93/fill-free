import type { Context } from "grammy";
import type { AppConfig, PromptAttachment, UploadedFile } from "../app/types";
import { logger } from "../app/logger";
import { saveTelegramFile, uploadedFileToAttachment } from "./transport";
import { persistState, rememberUploads, touchActivity } from "../app/state";
import { rememberTelegramParticipants } from "../telegram/identity";
import { summarizeIncomingText, telegramReplySummary } from "../telegram/reply_context";

export type SavedFileIngress = {
  uploaded: UploadedFile;
  attachment: PromptAttachment;
  caption: string;
  telegramMessageTime?: string;
};

export async function ingestTelegramFile(
  ctx: Context,
  config: AppConfig,
  scopeKey: string,
): Promise<SavedFileIngress | null> {
  const caption = ctx.message && "caption" in ctx.message ? ctx.message.caption?.trim() || "" : "";
  const uploaded = await saveTelegramFile(ctx, config);
  if (!uploaded) return null;

  touchActivity();
  if (rememberTelegramParticipants(config, ctx)) {
    await persistState(config.paths.stateFile);
  }
  await logger.info(`saved telegram file ${uploaded.savedPath}`);

  rememberUploads(scopeKey, [uploaded]);

  const attachment = await uploadedFileToAttachment(uploaded);
  return {
    uploaded,
    attachment,
    caption,
  };
}

export async function logFilePromptScheduling(ctx: Context, uploaded: UploadedFile, caption: string): Promise<void> {
  await logger.info(
    `received ${uploaded.source} message chat=${ctx.chat?.id ?? "unknown"} user=${ctx.from?.id ?? "unknown"} message=${ctx.message?.message_id ?? "unknown"} caption=${JSON.stringify(summarizeIncomingText(caption))}${telegramReplySummary(ctx)} and scheduled prompt task`,
  );
}
