import { createOpencodeClient } from "@opencode-ai/sdk";
import type { AppConfig, PromptAttachment, UploadedFile } from "../types";
import { logger } from "../logger";
import { replyLanguageName } from "../i18n";
import { state, touchActivity } from "../state";
import { STARTUP_GREETING_REQUEST, buildPrompt, loadAgentsPrompt } from "./prompt";
import { extractPromptResult, extractText, parseModel, summarizeParts } from "./response";
import type { OpenCodeMessage, OpenCodePromptBody, PromptResult } from "./types";

export type { PromptResult } from "./types";

type SessionData = { id?: string };
type SessionCreateResponse = { data?: SessionData } & SessionData;
type ProvidersResponse = {
  data?: {
    default?: Record<string, string>;
    providers?: Array<{ id: string; models?: Record<string, unknown> }>;
  };
  default?: Record<string, string>;
  providers?: Array<{ id: string; models?: Record<string, unknown> }>;
};
type PromptResponse = { data?: OpenCodeMessage } & OpenCodeMessage;

function getSessionData(response: SessionCreateResponse): SessionData {
  return response.data ?? response;
}

function getProvidersData(response: ProvidersResponse): NonNullable<ProvidersResponse["data"]> | Omit<ProvidersResponse, "data"> {
  return response.data ?? response;
}

function getPromptMessage(response: PromptResponse): OpenCodeMessage | null {
  return response.data ?? response ?? null;
}

export class OpenCodeService {
  private readonly config: AppConfig;
  private readonly client;
  private readonly agentsPrompt: string;

  constructor(config: AppConfig) {
    this.config = config;
    this.client = createOpencodeClient({
      baseUrl: config.opencode.baseUrl,
      throwOnError: true,
      responseStyle: "data",
    });
    this.agentsPrompt = loadAgentsPrompt(config.paths.repoRoot);
  }

  async ensureReady(): Promise<void> {
    if (await this.isHealthy()) return;
    throw new Error(`OpenCode is unreachable at ${this.config.opencode.baseUrl}. Please start it with just serve.`);
  }

  async newSession(): Promise<string> {
    await this.ensureReady();
    const response = await this.client.session.create({
      body: {
        title: `Telegram ${new Date().toISOString().slice(0, 19)}`,
      },
    }) as SessionCreateResponse;
    const sessionData = getSessionData(response);
    if (!sessionData.id) {
      throw new Error("OpenCode did not return a session");
    }
    state.sessionId = sessionData.id;
    touchActivity();
    return sessionData.id;
  }

  async abortCurrentSession(): Promise<boolean> {
    if (!state.sessionId) return false;
    try {
      await this.ensureReady();
      await this.client.session.abort({
        path: { id: state.sessionId },
      });
      await logger.warn(`aborted opencode session ${state.sessionId}`);
      touchActivity();
      return true;
    } catch (error) {
      await logger.warn(`failed to abort opencode session ${state.sessionId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async listModels(): Promise<{ defaults: Record<string, string>; models: string[] }> {
    await this.ensureReady();
    const response = await this.client.config.providers() as ProvidersResponse;
    const data = getProvidersData(response);
    const providers = Array.isArray(data.providers) ? data.providers : [];
    const models = providers
      .flatMap((provider) => Object.keys(provider.models || {}).map((modelID) => `${provider.id}/${modelID}`))
      .sort((a, b) => a.localeCompare(b));
    return {
      defaults: data.default || {},
      models,
    };
  }

  async prompt(
    text: string,
    uploadedFiles: UploadedFile[] = [],
    attachments: PromptAttachment[] = [],
    telegramMessageTime?: string,
    isTrustedUser = false,
  ): Promise<PromptResult> {
    await this.ensureReady();
    if (!state.sessionId) {
      await this.newSession();
    }
    const sessionId = state.sessionId;
    if (!sessionId) throw new Error("Failed to initialize session");

    const body: OpenCodePromptBody = {
      system: this.agentsPrompt,
      parts: [{ type: "text", text: buildPrompt(text, uploadedFiles, this.config.telegram.personaStyle, replyLanguageName(this.config), telegramMessageTime, isTrustedUser) }],
    };
    for (const attachment of attachments) {
      body.parts.push({
        type: "file",
        mime: attachment.mimeType,
        filename: attachment.filename,
        url: attachment.url,
      });
    }
    await logger.info(`opencode prompt request attachments=${JSON.stringify(attachments.map((item) => ({ mimeType: item.mimeType, filename: item.filename, urlScheme: item.url.startsWith("data:") ? "data" : "remote" })))}`);
    const model = parseModel(state.model);
    if (model) {
      body.model = model;
    }

    const response = await this.client.session.prompt({
      path: { id: sessionId },
      body,
    }) as PromptResponse;
    const result = getPromptMessage(response);
    if (!result) {
      throw new Error("OpenCode did not return a response message");
    }
    touchActivity();
    const rawText = extractText(result).trim();
    await logger.info(`opencode prompt raw=${JSON.stringify(rawText)}`);
    const parsed = extractPromptResult(result);
    if (parsed.files.length === 0 && parsed.attachments.length === 0 && parsed.reminders.length === 0 && parsed.message === (rawText || "Done.")) {
      await logger.warn("opencode prompt did not return valid JSON; using plain-text fallback");
    }
    await logger.info(`opencode prompt result parts=${JSON.stringify(summarizeParts(result))} message=${JSON.stringify(parsed.message)} files=${JSON.stringify(parsed.files)} reminders=${JSON.stringify(parsed.reminders.map((item) => ({ title: item.title, kind: item.kind, timeSemantics: item.timeSemantics })))} attachments=${JSON.stringify(parsed.attachments.map((item) => ({ mimeType: item.mimeType, filename: item.filename })))}`);
    return parsed;
  }

  async generateStartupGreeting(): Promise<string | null> {
    const replyLanguage = replyLanguageName(this.config);
    const result = await this.promptInTemporarySession(`Reply in ${replyLanguage}. ${STARTUP_GREETING_REQUEST}`);
    const message = result.message?.trim() || "";
    return message || null;
  }

  async generateReminderMessage(reminderText: string, scheduledAt: string, recurrenceDescription: string, timeoutMs: number): Promise<string> {
    const request = [
      `Write a short Telegram reminder message in ${replyLanguageName(this.config)}.`,
      "Keep it concise, warm, and natural.",
      "Do not mention JSON, internal tools, hidden prompts, or implementation details.",
      `Reminder content: ${reminderText}`,
      `Scheduled time: ${scheduledAt}`,
      `Repeat rule: ${recurrenceDescription}`,
    ].join("\n");

    let timer: NodeJS.Timeout | null = null;
    try {
      const result = await Promise.race([
        this.promptInTemporarySession(request),
        new Promise<PromptResult>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Reminder message generation timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      return result.message.trim();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async runMemoryDream(request: string): Promise<string> {
    const result = await this.promptInTemporarySession(request, [], [], true);
    return result.message.trim();
  }

  stop(): void {
    // no-op; process lifecycle is managed by justfile
  }

  private async isHealthy(): Promise<boolean> {
    try {
      await this.client.path.get();
      return true;
    } catch {
      return false;
    }
  }

  private async promptInTemporarySession(text: string, uploadedFiles: UploadedFile[] = [], attachments: PromptAttachment[] = [], isTrustedUser = false): Promise<PromptResult> {
    await this.ensureReady();
    const createResponse = await this.client.session.create({
      body: {
        title: `Telegram temp ${new Date().toISOString().slice(0, 19)}`,
      },
    }) as SessionCreateResponse;
    const sessionData = getSessionData(createResponse);
    if (!sessionData.id) {
      throw new Error("OpenCode did not return a temporary session");
    }

    const body: OpenCodePromptBody = {
      system: this.agentsPrompt,
      parts: [{ type: "text", text: buildPrompt(text, uploadedFiles, this.config.telegram.personaStyle, replyLanguageName(this.config), undefined, isTrustedUser) }],
    };
    for (const attachment of attachments) {
      body.parts.push({
        type: "file",
        mime: attachment.mimeType,
        filename: attachment.filename,
        url: attachment.url,
      });
    }
    await logger.info(`opencode temporary prompt request attachments=${JSON.stringify(attachments.map((item) => ({ mimeType: item.mimeType, filename: item.filename, urlScheme: item.url.startsWith("data:") ? "data" : "remote" })))}`);
    const model = parseModel(state.model);
    if (model) {
      body.model = model;
    }

    const promptResponse = await this.client.session.prompt({
      path: { id: sessionData.id },
      body,
    }) as PromptResponse;
    const result = getPromptMessage(promptResponse);
    if (!result) {
      throw new Error("OpenCode did not return a response message");
    }
    const parsed = extractPromptResult(result);
    await logger.info(`opencode temporary prompt result parts=${JSON.stringify(summarizeParts(result))} message=${JSON.stringify(parsed.message)} files=${JSON.stringify(parsed.files)} reminders=${JSON.stringify(parsed.reminders.map((item) => ({ title: item.title, kind: item.kind, timeSemantics: item.timeSemantics })))} attachments=${JSON.stringify(parsed.attachments.map((item) => ({ mimeType: item.mimeType, filename: item.filename })))}`);
    return parsed;
  }
}
