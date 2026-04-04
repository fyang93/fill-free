import type { Context } from "grammy";
import type { AiTurnResult } from "support/ai";
import type { AppConfig } from "scheduling/app/types";
import { logger } from "scheduling/app/logger";
import { t } from "scheduling/app/i18n";
import { sendLocalFiles, sendAiAttachments } from "interaction/telegram/transport";
import { replyFormatted } from "interaction/telegram/format";

export async function deliverAiOutputs(ctx: Context, config: AppConfig, answer: AiTurnResult): Promise<void> {
  const sentAttachments = answer.attachments.length > 0
    ? await sendAiAttachments(ctx, config, answer.attachments)
    : 0;
  if (sentAttachments > 0) {
    await logger.info(`sent ${sentAttachments} direct attachments back to the current chat`);
  }

  const sentFiles = answer.files.length > 0
    ? await sendLocalFiles(ctx, config, answer.files)
    : [];
  if (sentFiles.length > 0) {
    await logger.info(`sent files back to the current chat: ${sentFiles.join(", ")}`);
    return;
  }
  if (answer.files.length > 0) {
    await logger.warn(`file send failed for candidates: ${answer.files.join(", ")}`);
    await replyFormatted(ctx, t(config, "send_failed"));
  }
}
