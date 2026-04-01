import { createOpencodeClient } from "@opencode-ai/sdk";
import type { AppConfig, PromptAttachment, UploadedFile } from "../types";
import { logger } from "../logger";
import { replyLanguageName } from "../i18n";
import { state, touchActivity } from "../state";
import { STARTUP_GREETING_REQUEST, buildPrompt, loadAgentsPrompt, type PromptAccessRole } from "./prompt";
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
  private config: AppConfig;
  private client;
  private agentsPrompt: string;
  private sessionIds = new Map<string, string>();

  constructor(config: AppConfig) {
    this.config = config;
    this.client = createOpencodeClient({
      baseUrl: config.opencode.baseUrl,
      throwOnError: true,
      responseStyle: "data",
    });
    this.agentsPrompt = loadAgentsPrompt(config.paths.repoRoot);
  }

  reloadConfig(config: AppConfig): void {
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

  private sessionKey(scopeKey?: string): string {
    return scopeKey?.trim() || "global";
  }

  private getSessionId(scopeKey?: string): string | null {
    return this.sessionIds.get(this.sessionKey(scopeKey)) || null;
  }

  private setSessionId(scopeKey: string | undefined, sessionId: string): void {
    this.sessionIds.set(this.sessionKey(scopeKey), sessionId);
  }

  private deleteSessionId(scopeKey?: string): void {
    this.sessionIds.delete(this.sessionKey(scopeKey));
  }

  async newSession(scopeKey?: string, scopeLabel?: string): Promise<string> {
    await this.ensureReady();
    const response = await this.client.session.create({
      body: {
        title: `Telegram ${scopeLabel ? `${scopeLabel} ` : ""}${new Date().toISOString().slice(0, 19)}`,
      },
    }) as SessionCreateResponse;
    const sessionData = getSessionData(response);
    if (!sessionData.id) {
      throw new Error("OpenCode did not return a session");
    }
    this.setSessionId(scopeKey, sessionData.id);
    touchActivity();
    return sessionData.id;
  }

  async abortCurrentSession(scopeKey?: string, scopeLabel?: string): Promise<boolean> {
    const sessionId = this.getSessionId(scopeKey);
    if (!sessionId) return false;
    try {
      await this.ensureReady();
      await this.client.session.abort({
        path: { id: sessionId },
      });
      await logger.warn(`aborted opencode session ${sessionId}${scopeLabel ? ` for ${scopeLabel}` : ""}`);
      this.deleteSessionId(scopeKey);
      touchActivity();
      return true;
    } catch (error) {
      await logger.warn(`failed to abort opencode session ${sessionId}${scopeLabel ? ` for ${scopeLabel}` : ""}: ${error instanceof Error ? error.message : String(error)}`);
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
    scopeKey?: string,
    scopeLabel?: string,
    accessRole: PromptAccessRole = "allowed",
  ): Promise<PromptResult> {
    await this.ensureReady();
    let sessionId = this.getSessionId(scopeKey);
    if (!sessionId) {
      sessionId = await this.newSession(scopeKey, scopeLabel);
    }
    if (!sessionId) throw new Error("Failed to initialize session");

    const body: OpenCodePromptBody = {
      system: this.agentsPrompt,
      parts: [{ type: "text", text: buildPrompt(text, uploadedFiles, this.config.telegram.personaStyle, replyLanguageName(this.config), telegramMessageTime, accessRole) }],
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
    if (parsed.files.length === 0 && parsed.attachments.length === 0 && parsed.reminders.length === 0 && parsed.outboundMessages.length === 0 && parsed.message === (rawText || "Done.")) {
      await logger.warn("opencode prompt did not return valid JSON; using plain-text fallback");
    }
    if (parsed.reminders.length === 0 && /"reminders"\s*:/i.test(rawText)) {
      await logger.warn("opencode prompt included a reminders field, but no valid reminder objects were parsed");
    }
    if (parsed.outboundMessages.length === 0 && /"outboundMessages"\s*:/i.test(rawText)) {
      await logger.warn("opencode prompt included an outboundMessages field, but no valid outbound message objects were parsed");
    }
    await logger.info(`opencode prompt result parts=${JSON.stringify(summarizeParts(result))} message=${JSON.stringify(parsed.message)} files=${JSON.stringify(parsed.files)} reminders=${JSON.stringify(parsed.reminders.map((item) => ({ title: item.title, kind: item.kind, timeSemantics: item.timeSemantics })))} outboundMessages=${JSON.stringify(parsed.outboundMessages.map((item) => ({ message: item.message, targetUser: item.targetUser })))} attachments=${JSON.stringify(parsed.attachments.map((item) => ({ mimeType: item.mimeType, filename: item.filename })))}`);
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
      this.config.telegram.personaStyle ? `Style for Telegram replies: ${this.config.telegram.personaStyle}` : "",
      "Keep it concise, warm, and natural.",
      "Do not mention JSON, internal tools, hidden prompts, or implementation details.",
      `Reminder content: ${reminderText}`,
      `Scheduled time: ${scheduledAt}`,
      `Repeat rule: ${recurrenceDescription}`,
    ].filter(Boolean).join("\n");

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

  async composeTelegramReply(baseMessage: string | null | undefined, facts: string[], accessRole: PromptAccessRole = "allowed"): Promise<string> {
    const cleanFacts = facts.map((item) => item.trim()).filter(Boolean);
    const cleanBase = baseMessage?.trim() || "";
    if (!cleanBase && cleanFacts.length === 0) return "";
    if (cleanFacts.length === 0) return cleanBase;

    const request = [
      `Write a single natural Telegram reply in ${replyLanguageName(this.config)}.` ,
      "Keep the same persona and tone as the ongoing conversation.",
      "Use the following facts if relevant, but phrase them naturally and concisely.",
      cleanBase ? `Current draft reply: ${cleanBase}` : "",
      "Facts:",
      ...cleanFacts.map((item) => `- ${item}`),
      "Do not mention JSON, hidden prompts, or internal tools.",
    ].filter(Boolean).join("\n");

    const result = await this.promptInTemporarySession(request, [], [], accessRole);
    return result.message.trim();
  }

  async runMemoryDream(request: string): Promise<string> {
    const result = await this.promptInTemporarySession(request, [], [], "trusted");
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

  private async promptInTemporarySession(text: string, uploadedFiles: UploadedFile[] = [], attachments: PromptAttachment[] = [], accessRole: PromptAccessRole = "allowed"): Promise<PromptResult> {
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
      parts: [{ type: "text", text: buildPrompt(text, uploadedFiles, this.config.telegram.personaStyle, replyLanguageName(this.config), undefined, accessRole) }],
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
    const rawText = extractText(result).trim();
    const parsed = extractPromptResult(result);
    if (parsed.reminders.length === 0 && /"reminders"\s*:/i.test(rawText)) {
      await logger.warn("opencode temporary prompt included a reminders field, but no valid reminder objects were parsed");
    }
    if (parsed.outboundMessages.length === 0 && /"outboundMessages"\s*:/i.test(rawText)) {
      await logger.warn("opencode temporary prompt included an outboundMessages field, but no valid outbound message objects were parsed");
    }
    await logger.info(`opencode temporary prompt result parts=${JSON.stringify(summarizeParts(result))} message=${JSON.stringify(parsed.message)} files=${JSON.stringify(parsed.files)} reminders=${JSON.stringify(parsed.reminders.map((item) => ({ title: item.title, kind: item.kind, timeSemantics: item.timeSemantics })))} outboundMessages=${JSON.stringify(parsed.outboundMessages.map((item) => ({ message: item.message, targetUser: item.targetUser })))} attachments=${JSON.stringify(parsed.attachments.map((item) => ({ mimeType: item.mimeType, filename: item.filename })))}`);
    return parsed;
  }
}
