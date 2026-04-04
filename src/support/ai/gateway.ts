import { createOpencodeClient } from "@opencode-ai/sdk";
import type { AppConfig, AiAttachment, UploadedFile } from "scheduling/app/types";
import { logger } from "scheduling/app/logger";
import { state, touchActivity } from "scheduling/app/state";
import { buildProjectSystemPrompt, type RequestAccessRole } from "./prompt";
import { extractAiTurnResultFromText } from "./response";
import type { AiTurnResult } from "./types";
import { ReplyComposer, type ReplyComposerInputContext } from "./reply-composer";
import { StructuredReasoner } from "./structured-reasoner";

export type { AiTurnResult } from "./types";

type SessionEntry = {
  sessionId: string;
};

type PromptRole = "responder" | "executor" | "maintainer" | "greeter";

type PromptToolsConfig = Record<string, boolean>;

function parseModel(model: string | null): { providerID: string; modelID: string } | null {
  if (!model) return null;
  const index = model.indexOf("/");
  if (index <= 0 || index === model.length - 1) return null;
  return {
    providerID: model.slice(0, index),
    modelID: model.slice(index + 1),
  };
}

function extractText(message: unknown): string {
  const record = message && typeof message === "object" ? message as { parts?: Array<{ type?: string; text?: string }> } : {};
  const texts = (record.parts || [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim())
    .filter(Boolean);
  return texts.length > 0 ? texts.join("\n\n") : "";
}

export class AiService {
  private config: AppConfig;
  private readonly client;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly replyComposer: ReplyComposer;
  private readonly structuredReasoner: StructuredReasoner;

  constructor(config: AppConfig) {
    this.config = config;
    this.client = createOpencodeClient({
      baseUrl: config.opencode.baseUrl,
      throwOnError: true,
      responseStyle: "data",
    });
    this.replyComposer = new ReplyComposer(
      config,
      (text) => this.promptInLightTextSession(text, "responder"),
      (text) => this.promptInLightTextSession(text, "greeter"),
    );
    this.structuredReasoner = new StructuredReasoner(config, (promptText, attachments, scopeKey) => this.promptWithCurrentLightSession(promptText, attachments, scopeKey), (attachments) => this.attachmentLogSummary(attachments));
  }

  reloadConfig(config: AppConfig): void {
    this.config = config;
    this.replyComposer.updateConfig(config);
    this.structuredReasoner.updateConfig(config);
  }

  async ensureReady(): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.client.path.get();
      await logger.info(`opencode healthcheck ok ms=${Date.now() - startedAt} baseUrl=${this.config.opencode.baseUrl}`);
    } catch (error) {
      throw new Error(`OpenCode is unreachable at ${this.config.opencode.baseUrl}. Start the OpenCode server first. ${error instanceof Error ? error.message : String(error)}`.trim());
    }
  }

  private sessionKey(scopeKey?: string): string {
    return scopeKey?.trim() || "global";
  }

  private async createSession(scopeKey?: string, scopeLabel?: string): Promise<SessionEntry> {
    const startedAt = Date.now();
    await this.ensureReady();
    const response = await this.client.session.create({
      body: { title: scopeLabel?.trim() || `Chat ${scopeKey?.trim() || new Date().toISOString().slice(0, 19)}` },
    }) as any;
    const data = response.data ?? response;
    if (!data?.id || typeof data.id !== "string") {
      throw new Error("OpenCode did not return a session id");
    }
    await logger.info(`opencode session created ms=${Date.now() - startedAt} scope=${JSON.stringify(scopeKey || "global")} title=${JSON.stringify(scopeLabel?.trim() || "")}`);
    return { sessionId: data.id };
  }

  private async getOrCreateSession(scopeKey?: string, scopeLabel?: string): Promise<SessionEntry> {
    const key = this.sessionKey(scopeKey);
    const existing = this.sessions.get(key);
    if (existing) return existing;
    const created = await this.createSession(scopeKey, scopeLabel);
    this.sessions.set(key, created);
    return created;
  }

  private async disposeSession(scopeKey?: string): Promise<boolean> {
    const key = this.sessionKey(scopeKey);
    const entry = this.sessions.get(key);
    if (!entry) return false;
    try {
      await this.client.session.abort({ path: { id: entry.sessionId } }).catch(() => {});
    } finally {
      this.sessions.delete(key);
    }
    return true;
  }

  async newSession(scopeKey?: string, scopeLabel?: string): Promise<string> {
    await this.disposeSession(scopeKey);
    const entry = await this.createSession(scopeKey, scopeLabel);
    this.sessions.set(this.sessionKey(scopeKey), entry);
    touchActivity();
    return entry.sessionId;
  }

  async abortCurrentSession(scopeKey?: string, scopeLabel?: string): Promise<boolean> {
    const aborted = await this.disposeSession(scopeKey);
    if (aborted) {
      await logger.warn(`aborted opencode session${scopeLabel ? ` for ${scopeLabel}` : ""}`);
      touchActivity();
    }
    return aborted;
  }

  async listModels(): Promise<{ defaults: Record<string, string>; models: string[] }> {
    await this.ensureReady();
    const response = await this.client.config.providers() as any;
    const data = response.data ?? response;
    const providers = Array.isArray(data.providers) ? data.providers : [];
    return {
      defaults: data.default && typeof data.default === "object" ? data.default as Record<string, string> : {},
      models: providers.flatMap((provider: any) => Object.keys(provider.models || {}).map((modelID) => `${provider.id}/${modelID}`)).sort((a: string, b: string) => a.localeCompare(b)),
    };
  }

  async prompt(
    text: string,
    uploadedFiles: UploadedFile[] = [],
    attachments: AiAttachment[] = [],
    messageTime?: string,
    scopeKey?: string,
    scopeLabel?: string,
    accessRole: RequestAccessRole = "allowed",
    responderContextText?: string,
    requesterTimezone?: string | null,
  ): Promise<AiTurnResult> {
    return this.structuredReasoner.run(text, uploadedFiles, attachments, messageTime, accessRole, scopeKey || scopeLabel, responderContextText, requesterTimezone);
  }

  async generateStartupGreeting(input?: ReplyComposerInputContext): Promise<string | null> {
    return this.replyComposer.generateStartupGreeting(input);
  }

  async generateReminderMessage(reminderText: string, scheduledAt: string, recurrenceDescription: string): Promise<string> {
    return this.replyComposer.generateReminderMessage(reminderText, scheduledAt, recurrenceDescription);
  }

  async composeUserReply(baseMessage: string | null | undefined, facts: string[], input?: ReplyComposerInputContext): Promise<string> {
    return this.replyComposer.composeUserReply(baseMessage, facts, input);
  }

  async composeFinalUserReply(draftMessage: string | null | undefined, facts: string[], input?: ReplyComposerInputContext): Promise<string> {
    const cleanDraft = this.replyComposer.sanitizeUserFacingDraft(draftMessage || "");
    return this.replyComposer.composeUserReply(cleanDraft, facts, input);
  }

  async composeOutboundRelayMessage(baseMessage: string, recipientLabel: string | undefined): Promise<string> {
    return this.replyComposer.composeOutboundRelayMessage(baseMessage, recipientLabel);
  }

  async runMaintenancePass(request: string): Promise<string> {
    return (await this.promptInTemporaryTextSession(request, "maintainer")).trim();
  }

  async planExecutorActionsFromText(input: {
    taskText: string;
    userRequestText: string;
    requesterUserId?: number;
    chatId?: number;
    chatType?: string;
    accessRole: RequestAccessRole;
    messageTime?: string;
    responderContextText?: string;
  }): Promise<AiTurnResult> {
    const prompt = [
      "You are executor planning. Convert task intent into executable structured actions.",
      "Output exactly one JSON object with top-level fields: message, files, reminders, outboundMessages, pendingAuthorizations, tasks.",
      "Set message to an empty string unless clarification is required.",
      "Do not include markdown fences.",
      "",
      "Execution context:",
      `requesterUserId=${input.requesterUserId ?? "unknown"}`,
      `chatId=${input.chatId ?? "unknown"}`,
      `chatType=${input.chatType || "unknown"}`,
      `accessRole=${input.accessRole}`,
      input.messageTime ? `messageTime=${input.messageTime}` : "",
      "",
      "Original user request:",
      input.userRequestText.trim(),
      "",
      "Responder delegated task text:",
      input.taskText.trim(),
      "",
      input.responderContextText?.trim() ? "Responder context:" : "",
      input.responderContextText?.trim() || "",
    ].filter(Boolean).join("\n");
    const raw = await this.promptInTemporaryTextSession(prompt, "executor");
    const parsed = extractAiTurnResultFromText(raw);
    return {
      ...parsed,
      executorTaskText: "",
    };
  }

  stop(): void {
    this.sessions.clear();
  }

  private buildParts(text: string, attachments: AiAttachment[]): Array<{ type: "text"; text: string } | { type: "file"; mime: string; filename?: string; url: string }> {
    const parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; filename?: string; url: string }> = [{ type: "text", text }];
    for (const attachment of attachments) {
      if (!attachment.url) continue;
      parts.push({
        type: "file",
        mime: attachment.mimeType,
        filename: attachment.filename,
        url: attachment.url,
      });
    }
    return parts;
  }

  private async promptInTemporaryTextSession(text: string, role: "executor" | "maintainer"): Promise<string> {
    return this.promptInDisposableTextSession({
      title: role === "maintainer" ? "Maintainer" : "Executor",
      requestLog: `opencode ${role} text prompt request`,
      rawLogLabel: `opencode ${role} text prompt`,
      execute: (sessionId) => this.promptSessionForText(sessionId, text, [], role),
    });
  }

  private async promptInLightTextSession(text: string, role?: PromptRole): Promise<string> {
    return this.promptInDisposableTextSession({
      title: "Light text",
      requestLog: "opencode light text prompt request",
      rawLogLabel: "opencode light text prompt",
      execute: (sessionId) => this.promptSessionForLightText(sessionId, text, [], role),
    });
  }

  private async promptInDisposableTextSession(input: {
    title: string;
    requestLog: string;
    rawLogLabel: string;
    execute: (sessionId: string) => Promise<string>;
  }): Promise<string> {
    const session = await this.createSession(undefined, input.title);
    try {
      await logger.info(input.requestLog);
      const rawText = await input.execute(session.sessionId);
      touchActivity();
      await logger.info(`${input.rawLogLabel} raw=${JSON.stringify(rawText)}`);
      return rawText;
    } finally {
      await this.client.session.abort({ path: { id: session.sessionId } }).catch(() => {});
    }
  }

  private systemPromptForRole(role: PromptRole): string {
    return buildProjectSystemPrompt(this.config.bot.personaStyle, role);
  }

  private toolsForRole(role?: PromptRole): PromptToolsConfig | undefined {
    if (role !== "greeter" && role !== "responder") return undefined;
    return {
      read: false,
      edit: false,
      write: false,
      patch: false,
      bash: false,
      glob: false,
      grep: false,
      list: false,
      webfetch: false,
      websearch: false,
      codesearch: false,
      task: false,
      question: false,
      todowrite: false,
      lsp: false,
      skill: false,
    };
  }

  private async promptAndParse(sessionId: string, text: string, attachments: AiAttachment[], temporary: boolean): Promise<AiTurnResult> {
    const startedAt = Date.now();
    await logger.info(`opencode prompt start temporary=${temporary ? "yes" : "no"} sessionId=${sessionId} model=${JSON.stringify(state.model || "default")} textChars=${text.length} attachments=${attachments.length}`);
    const response = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        system: this.systemPromptForRole("responder"),
        model: parseModel(state.model) || undefined,
        parts: this.buildParts(text, attachments),
      },
    }) as any;

    touchActivity();
    const payload = response.data ?? response;
    const rawText = extractText(payload);
    const promptMs = Date.now() - startedAt;
    const partCount = Array.isArray(payload?.parts) ? payload.parts.length : 0;
    await logger.info(`opencode prompt response ms=${promptMs} temporary=${temporary ? "yes" : "no"} sessionId=${sessionId} parts=${partCount} rawChars=${rawText.length}`);
    const parsed = extractAiTurnResultFromText(rawText);
    await this.logParsedAiTurnResult(rawText, parsed, temporary);

    if (parsed.message.trim() || parsed.files.length > 0 || parsed.fileWrites.length > 0 || parsed.reminders.length > 0 || parsed.outboundMessages.length > 0 || parsed.pendingAuthorizations.length > 0 || parsed.tasks.length > 0 || parsed.executorTaskText.trim()) {
      return parsed;
    }
    throw new Error("Model returned no displayable output.");
  }

  private async promptWithCurrentSession(text: string, attachments: AiAttachment[], scopeKey?: string): Promise<AiTurnResult> {
    const entry = await this.getOrCreateSession(scopeKey, scopeKey);
    return this.promptAndParse(entry.sessionId, text, attachments, false);
  }

  private async promptWithCurrentLightSession(text: string, attachments: AiAttachment[], scopeKey?: string): Promise<AiTurnResult> {
    const entry = await this.getOrCreateSession(scopeKey, scopeKey);
    const rawText = await this.promptSessionForLightText(entry.sessionId, text, attachments, "responder");
    touchActivity();
    const parsed = extractAiTurnResultFromText(rawText);
    await this.logParsedAiTurnResult(rawText, parsed, false);
    if (parsed.message.trim() || parsed.files.length > 0 || parsed.fileWrites.length > 0 || parsed.reminders.length > 0 || parsed.outboundMessages.length > 0 || parsed.pendingAuthorizations.length > 0 || parsed.tasks.length > 0 || parsed.executorTaskText.trim()) {
      return parsed;
    }
    throw new Error("Model returned no displayable output.");
  }

  private async promptSessionForText(sessionId: string, text: string, attachments: AiAttachment[], role: "executor" | "maintainer"): Promise<string> {
    const startedAt = Date.now();
    await logger.info(`opencode text prompt start sessionId=${sessionId} model=${JSON.stringify(state.model || "default")} textChars=${text.length} attachments=${attachments.length} mode=full role=${role}`);
    const response = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        system: this.systemPromptForRole(role),
        model: parseModel(state.model) || undefined,
        parts: this.buildParts(text, attachments),
      },
    }) as any;
    const payload = response.data ?? response;
    const rawText = extractText(payload).trim();
    await logger.info(`opencode text prompt response ms=${Date.now() - startedAt} sessionId=${sessionId} rawChars=${rawText.length} parts=${Array.isArray(payload?.parts) ? payload.parts.length : 0} mode=full role=${role}`);
    if (!rawText) throw new Error("OpenCode returned no text output.");
    return rawText;
  }

  private async promptSessionForLightText(sessionId: string, text: string, attachments: AiAttachment[], role?: PromptRole): Promise<string> {
    const startedAt = Date.now();
    await logger.info(`opencode text prompt start sessionId=${sessionId} model=${JSON.stringify(state.model || "default")} textChars=${text.length} attachments=${attachments.length} mode=light${role ? ` role=${role}` : ""}`);
    const response = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        system: role ? this.systemPromptForRole(role) : undefined,
        model: parseModel(state.model) || undefined,
        tools: this.toolsForRole(role),
        parts: this.buildParts(text, attachments),
      },
    }) as any;
    const payload = response.data ?? response;
    const rawText = extractText(payload).trim();
    await logger.info(`opencode text prompt response ms=${Date.now() - startedAt} sessionId=${sessionId} rawChars=${rawText.length} parts=${Array.isArray(payload?.parts) ? payload.parts.length : 0} mode=light`);
    if (!rawText) throw new Error("OpenCode returned no text output.");
    return rawText;
  }

  private attachmentLogSummary(attachments: AiAttachment[]): Array<{ mimeType: string; filename?: string; urlScheme: string }> {
    return attachments.map((attachment) => ({
      mimeType: attachment.mimeType,
      filename: attachment.filename,
      urlScheme: attachment.url.startsWith("data:") ? "data" : attachment.url.startsWith("http") ? "http" : "other",
    }));
  }

  private async logParsedAiTurnResult(rawText: string, parsed: AiTurnResult, temporary: boolean): Promise<void> {
    const label = temporary ? "opencode temporary prompt" : "opencode prompt";
    await logger.info(`${label} raw=${JSON.stringify(rawText)}`);
    await logger.info(`${label} result message=${JSON.stringify(parsed.message)} files=${JSON.stringify(parsed.files)} fileWrites=${parsed.fileWrites.length} reminders=${parsed.reminders.length} outboundMessages=${parsed.outboundMessages.length} pendingAuthorizations=${parsed.pendingAuthorizations.length} tasks=${parsed.tasks.length} executorTaskChars=${parsed.executorTaskText.length}`);
  }
}
