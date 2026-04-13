import type { Context } from "grammy";
import type { AiTurnResult } from "bot/ai";
import type { AppConfig } from "bot/app/types";
import { logger } from "bot/app/logger";
import { tForUser } from "bot/app/i18n";
import { extractCandidateFilePaths, sendLocalFiles, sendAiAttachments } from "bot/telegram/transport";
import { replyFormatted } from "bot/telegram/format";

export async function deliverAiOutputs(ctx: Context, config: AppConfig, answer: AiTurnResult): Promise<void> {
  const sentAttachments = answer.attachments.length > 0
    ? await sendAiAttachments(ctx, config, answer.attachments)
    : 0;
  if (sentAttachments > 0) {
    await logger.info(`sent ${sentAttachments} direct attachments back to the current chat`);
  }

  const fileCandidates = answer.files.length > 0 ? answer.files : extractCandidateFilePaths(answer.message);
  const sentFiles = fileCandidates.length > 0
    ? await sendLocalFiles(ctx, config, fileCandidates)
    : [];
  if (sentFiles.length > 0) {
    await logger.info(`sent files back to the current chat: ${sentFiles.join(", ")}`);
    return;
  }
  if (fileCandidates.length > 0) {
    await logger.warn(`file send failed for candidates: ${fileCandidates.join(", ")}`);
    await replyFormatted(ctx, tForUser(config, ctx.from?.id, "send_failed"));
  }
}
