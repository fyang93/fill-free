import type { AppConfig, AiAttachment, UploadedFile } from "scheduling/app/types";
import { logger } from "scheduling/app/logger";
import { replyLanguageName } from "scheduling/app/i18n";
import { buildPrompt, type RequestAccessRole } from "./prompt";
import type { AiTurnResult } from "./types";

export class StructuredReasoner {
  constructor(
    private config: AppConfig,
    private readonly executePrompt: (promptText: string, attachments: AiAttachment[], scopeKey?: string) => Promise<AiTurnResult>,
    private readonly summarizeAttachments: (attachments: AiAttachment[]) => Array<{ mimeType: string; filename?: string; urlScheme: string }>,
  ) {}

  updateConfig(config: AppConfig): void {
    this.config = config;
  }

  async run(
    text: string,
    uploadedFiles: UploadedFile[] = [],
    attachments: AiAttachment[] = [],
    messageTime?: string,
    accessRole: RequestAccessRole = "allowed",
    scopeKey?: string,
    responderContextText?: string,
    requesterTimezone?: string | null,
  ): Promise<AiTurnResult> {
    const promptText = buildPrompt(
      text,
      uploadedFiles,
      replyLanguageName(this.config),
      this.config.bot.defaultTimezone,
      this.config.bot.personaStyle,
      messageTime,
      accessRole,
      responderContextText,
      requesterTimezone,
    );
    await logger.info(`opencode prompt request attachments=${JSON.stringify(this.summarizeAttachments(attachments))}`);
    return this.executePrompt(promptText, attachments, scopeKey);
  }
}
