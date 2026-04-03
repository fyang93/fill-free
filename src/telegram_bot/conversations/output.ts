import type { Context } from "grammy";
import type { PromptResult } from "../agent";
import type { AppConfig } from "../app/types";
import { logger } from "../app/logger";
import { t } from "../app/i18n";
import { sendLocalFiles, sendPromptAttachments } from "../files/transport";
import { replyFormatted } from "../telegram/format";

export async function deliverPromptOutputs(ctx: Context, config: AppConfig, answer: PromptResult): Promise<void> {
  if (answer.attachments.length > 0) {
    const sentAttachments = await sendPromptAttachments(ctx, config, answer.attachments);
    if (sentAttachments > 0) await logger.info(`sent ${sentAttachments} direct attachments back to telegram`);
  }

  if (answer.files.length > 0) {
    const sentFiles = await sendLocalFiles(ctx, config, answer.files);
    if (sentFiles.length > 0) {
      await logger.info(`sent files back to telegram: ${sentFiles.join(", ")}`);
    } else {
      await logger.warn(`file send failed for candidates: ${answer.files.join(", ")}`);
      await replyFormatted(ctx, t(config, "send_failed"));
    }
  }
}
