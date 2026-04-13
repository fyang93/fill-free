import { createOpencodeClient } from "@opencode-ai/sdk";
import type { AppConfig, AiAttachment, UploadedFile } from "bot/app/types";
import { logger } from "bot/app/logger";
import { formatIsoInTimezoneParts } from "bot/app/time";
import { state, touchActivity } from "bot/app/state";
import { buildPersonaStyleLines, buildProjectSystemPrompt, type RequestAccessRole } from "./prompt";
import { extractAiTurnResultFromText, isDisplayableUserText } from "./response";
import type { AiTurnResult, AssistantPlanResult, AssistantProgressHandler } from "./types";
import { ReplyComposer, type ReplyComposerInputContext } from "./reply-composer";
import { StructuredReasoner } from "./structured-reasoner";

export type { AiTurnResult } from "./types";

type SessionEntry = {
  sessionId: string;
};

type PromptRole = "assistant" | "maintainer" | "writer";


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

function summarizeExecutionParts(parts: unknown): Array<{ tool: string; status: string; inputChars: number; outputChars: number }> {
  if (!Array.isArray(parts)) return [];
  return parts.flatMap((part) => {
    if (!part || typeof part !== "object") return [];
    const record = part as Record<string, unknown>;
    if (record.type !== "tool") return [];
    const tool = typeof record.tool === "string" ? record.tool.trim() : "";
    const stateRecord = record.state && typeof record.state === "object" ? record.state as Record<string, unknown> : null;
    const status = stateRecord && typeof stateRecord.status === "string" ? stateRecord.status.trim() : "unknown";
    const input = stateRecord?.input;
    const output = stateRecord?.output;
    return [{
      tool,
      status,
      inputChars: typeof input === "string" ? input.length : JSON.stringify(input || "").length,
      outputChars: typeof output === "string" ? output.length : JSON.stringify(output || "").length,
    }];
  });
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
      directory: config.paths.repoRoot,
      throwOnError: true,
      responseStyle: "data",
    });
    this.replyComposer = new ReplyComposer(
      config,
      (text) => this.promptInLightTextSession(text, "writer"),
      (text) => this.promptInLightTextSession(text, "writer"),
    );
    this.structuredReasoner = new StructuredReasoner(config, (promptText, attachments, scopeKey) => this.promptAssistantTurn(promptText, attachments, scopeKey), (attachments) => this.attachmentLogSummary(attachments));
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
    _scopeLabel?: string,
    accessRole: RequestAccessRole = "allowed",
    sharedConversationContextText?: string,
    requesterTimezone?: string | null,
  ): Promise<AiTurnResult> {
    return this.structuredReasoner.run(text, uploadedFiles, attachments, messageTime, accessRole, scopeKey, sharedConversationContextText, requesterTimezone);
  }

  async generateStartupGreeting(input?: ReplyComposerInputContext): Promise<string | null> {
    return this.replyComposer.generateStartupGreeting(input);
  }

  async generateScheduleMessage(scheduleText: string, scheduledAt: string, recurrenceDescription: string): Promise<string> {
    return this.replyComposer.generateScheduleMessage(scheduleText, scheduledAt, recurrenceDescription);
  }

  async generateScheduledTaskContent(prompt: string): Promise<string> {
    const taskPrompt = prompt.trim();
    if (!taskPrompt) return "";
    const request = [
      "Generate fresh, useful content for this recurring automated task.",
      "Use tools when needed to gather current external information before writing the final message.",
      `Task prompt: ${taskPrompt}`,
    ].join("\n");
    return this.promptInDisposableAgentTextSession(request, "assistant");
  }

  async generateRuntimeAckMessage(kind: "initial" | "progress", input?: ReplyComposerInputContext): Promise<string> {
    return this.replyComposer.generateRuntimeAckMessage(kind, input);
  }

  async generateWaitingMessageCandidate(input?: ReplyComposerInputContext): Promise<string> {
    return this.replyComposer.generateWaitingMessageCandidate(input);
  }

  async generateWaitingMessageCandidates(count: number, input?: ReplyComposerInputContext): Promise<string[]> {
    return this.replyComposer.generateWaitingMessageCandidates(count, input);
  }

  async composeUserReply(baseMessage: string | null | undefined, facts: string[], input?: ReplyComposerInputContext): Promise<string> {
    return this.replyComposer.composeUserReply(baseMessage, facts, input);
  }

  async composeDeliveryMessage(baseMessage: string, recipientLabel: string | undefined): Promise<string> {
    return this.replyComposer.composeDeliveryMessage(baseMessage, recipientLabel);
  }

  async runMaintenancePass(request: string): Promise<string> {
    return (await this.promptInTemporaryTextSession(request, "maintainer")).trim();
  }

  async runAssistantTurn(input: {
    userRequestText: string;
    requesterUserId?: number;
    chatId?: number;
    chatType?: string;
    accessRole: RequestAccessRole;
    attachments?: AiAttachment[];
    messageTime?: string;
    requesterTimezone?: string | null;
    sharedConversationContextText?: string;
    scopeKey?: string;
    scopeLabel?: string;
    isTaskCurrent?: () => boolean;
    onProgress?: AssistantProgressHandler;
  }): Promise<AssistantPlanResult> {
    const localMessageTime = formatIsoInTimezoneParts(input.messageTime, input.requesterTimezone?.trim() || this.config.bot.defaultTimezone);
    const prompt = [
      "You are the main assistant agent for a local-first Telegram bot.",
      "Apply the configured persona directly in the final reply.",
      ...buildPersonaStyleLines(this.config.bot.personaStyle),
      "Memory-first rule: prefer repository-local sources first for memory, reminders, personal facts, files, logs, and project behavior.",
      "For questions about people, relationships, identities, histories, preferences, or other recorded facts, inspect relevant local memory/context before answering.",
      "For repository-grounded fact questions, do not answer from memory alone; first inspect local memory using tools or the memory skill.",
      "If relevant local memory likely exists, do not skip retrieval and do not answer with 'I don't know' until you have checked accessible local memory/context.",
      "Do not claim you searched, checked, or found no record unless tool execution or file inspection actually happened.",
      "If local memory is insufficient, state the missing information briefly instead of pretending certainty.",
      "system/ contains canonical system-managed state. Never directly edit or rewrite files under system/ during ordinary assistant work; when system state must change, use repository CLI or other deterministic repository code paths instead.",
      "Do not mention internal commands, shell usage, interface names, tool names, or implementation steps in the final reply unless the user explicitly asks for those technical details.",
      "Context:",
      `requesterUserId=${input.requesterUserId ?? "unknown"}`,
      `chatId=${input.chatId ?? "unknown"}`,
      `chatType=${input.chatType || "unknown"}`,
      `accessRole=${input.accessRole}`,
      localMessageTime ? `requesterLocalTime=${localMessageTime.localDateTime} (${localMessageTime.timezone})` : "",
      input.requesterTimezone?.trim() ? `requesterTimezone=${input.requesterTimezone.trim()}` : "",
      input.sharedConversationContextText?.trim() ? "Context block:" : "",
      input.sharedConversationContextText?.trim() || "",
      "User request:",
      input.userRequestText.trim(),
    ].filter(Boolean).join("\n");

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (input.isTaskCurrent && !input.isTaskCurrent()) {
        await logger.warn("assistant agent prompt skipped because task is stale");
        return { message: "", usedNativeExecution: false, completedActions: [], files: [], attachments: [] };
      }
      const attemptPrompt = attempt === 1
        ? prompt
        : [
            prompt,
            "",
            "Your previous output was invalid.",
            "Do not write XML, <invoke ...> blocks, or tool-call text.",
            "Use the needed tools, then return the final user-visible reply for this turn in the configured persona.",
          ].join("\n");
      const response = await this.promptInScopedAssistantSession(attemptPrompt, input.attachments || [], input.scopeKey, input.scopeLabel, input.onProgress);
      if (input.isTaskCurrent && !input.isTaskCurrent()) {
        await logger.warn("assistant agent response ignored because task became stale");
        return { message: "", usedNativeExecution: false, completedActions: response.completedActions, files: [], attachments: [] };
      }
      const rawText = response.rawText.trim();
      const parsed = extractAiTurnResultFromText(rawText);
      const hasStructuredOutputs = parsed.files.length > 0 || parsed.attachments.length > 0;
      const hasDisplayableMessage = !!parsed.message && isDisplayableUserText(parsed.message);
      if (response.usedNativeExecution) {
        if (hasDisplayableMessage || hasStructuredOutputs) {
          return {
            message: hasDisplayableMessage ? parsed.message : "",
            usedNativeExecution: response.usedNativeExecution,
            completedActions: response.completedActions,
            files: parsed.files,
            attachments: parsed.attachments,
          };
        }
        await logger.warn(`discarded assistant output attempt=${attempt} reason=non-displayable`);
        continue;
      }
      if (hasDisplayableMessage || hasStructuredOutputs) {
        return {
          message: hasDisplayableMessage ? parsed.message : "",
          usedNativeExecution: false,
          completedActions: [],
          files: parsed.files,
          attachments: parsed.attachments,
        };
      }
      await logger.warn(`discarded assistant output attempt=${attempt} reason=no-tools-and-no-displayable-text`);
    }
    throw new Error("Assistant output protocol violation: invalid turn result.");
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

  private systemPromptForRole(role: PromptRole): string {
    return buildProjectSystemPrompt(this.config.bot.personaStyle, role);
  }

  private async promptInTemporaryTextSession(text: string, role: "assistant" | "maintainer"): Promise<string> {
    return this.promptInDisposableTextSession({
      title: role === "maintainer" ? "Maintainer" : "Assistant",
      requestLog: `opencode ${role} text prompt request`,
      rawLogLabel: `opencode ${role} text prompt`,
      execute: (sessionId) => this.promptSessionForText(sessionId, text, [], role),
    });
  }

  private async promptInDisposableAgentTextSession(text: string, role: "assistant"): Promise<string> {
    return this.promptInDisposableTextSession({
      title: "Assistant",
      requestLog: `opencode ${role} text prompt request`,
      rawLogLabel: `opencode ${role} text prompt`,
      execute: async (sessionId) => {
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const attemptText = attempt === 1
            ? text
            : [
                text,
                "",
                "Your previous output was invalid.",
                "Use the needed tools, then return only plain user-visible text in the configured persona.",
              ].join("\n");
          const response = await this.promptSessionForAgent(sessionId, attemptText, [], role);
          const rawText = response.rawText.trim();
          if (rawText && isDisplayableUserText(rawText)) return rawText;
          await logger.warn(`discarded ${role} output attempt=${attempt} reason=${rawText ? "non-displayable" : "empty-output"}`);
        }
        throw new Error(`${role} output protocol violation: invalid text result.`);
      },
    });
  }

  private async promptInScopedAssistantSession(text: string, attachments: AiAttachment[], scopeKey?: string, scopeLabel?: string, onProgress?: AssistantProgressHandler): Promise<{ rawText: string; usedNativeExecution: boolean; completedActions: string[] }> {
    const entry = await this.getOrCreateSession(scopeKey, scopeLabel);
    await logger.info(`opencode assistant text prompt request`);
    const response = await this.promptSessionForAssistant(entry.sessionId, text, attachments, onProgress);
    touchActivity();
    await logger.info(`opencode assistant text prompt raw=${JSON.stringify(response.rawText)}`);
    return response;
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

  private async promptAssistantTurn(text: string, attachments: AiAttachment[], scopeKey?: string): Promise<AiTurnResult> {
    const agent = this.getOrCreateSession(scopeKey, scopeKey);
    const entry = await agent;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const promptText = attempt === 1
        ? text
        : [
            text,
            "",
            "Your previous output was invalid.",
            "Return a displayable user-visible reply text for this turn in the configured persona.",
          ].join("\n");

      let rawText = "";
      try {
        await logger.info(attempt === 1 ? "opencode prompt request" : "opencode prompt retry request");
        rawText = await this.promptSessionForLightText(entry.sessionId, promptText, attachments, "assistant");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/no text output/i.test(message) && attempt < 2) {
          await logger.warn(`discarded assistant output attempt=${attempt} reason=empty-output`);
          continue;
        }
        throw error;
      }
      touchActivity();
      const parsed: AiTurnResult = { message: rawText.trim(), files: [], fileWrites: [], attachments: [], schedules: [], deliveries: [], pendingAuthorizations: [], tasks: [] };
      await this.logParsedAiTurnResult(rawText, parsed, false);
      if (parsed.message.trim() && isDisplayableUserText(parsed.message)) {
        return parsed;
      }
      await logger.warn(`discarded assistant output attempt=${attempt} reason=non-displayable`);
    }
    throw new Error("Model returned no displayable user reply.");
  }

  private async promptSessionForText(sessionId: string, text: string, attachments: AiAttachment[], role: "assistant" | "maintainer"): Promise<string> {
    if (role === "assistant") {
      return (await this.promptSessionForAssistant(sessionId, text, attachments)).rawText;
    }
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

  private async promptSessionForAssistant(sessionId: string, text: string, attachments: AiAttachment[], _onProgress?: AssistantProgressHandler): Promise<{ rawText: string; usedNativeExecution: boolean; completedActions: string[] }> {
    return this.promptSessionForAgent(sessionId, text, attachments, "assistant");
  }

  private async promptSessionForAgent(sessionId: string, text: string, attachments: AiAttachment[], role: "assistant"): Promise<{ rawText: string; usedNativeExecution: boolean; completedActions: string[] }> {
    const startedAt = Date.now();
    await logger.info(`opencode text prompt start sessionId=${sessionId} model=${JSON.stringify(state.model || "default")} textChars=${text.length} attachments=${attachments.length} mode=full role=${role}`);
    const response = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: "build",
        system: this.systemPromptForRole(role),
        model: parseModel(state.model) || undefined,
        parts: this.buildParts(text, attachments),
      },
    }) as any;
    const payload = response.data ?? response;
    const rawText = extractText(payload).trim();
    const directCompletedActions = this.extractCompletedActions(payload?.parts);
    const completedActions = directCompletedActions.length > 0
      ? directCompletedActions
      : await this.extractCompletedActionsFromSessionHistory(sessionId, payload);
    const executionParts = summarizeExecutionParts(payload?.parts);
    await logger.info(`opencode text prompt response ms=${Date.now() - startedAt} sessionId=${sessionId} rawChars=${rawText.length} parts=${Array.isArray(payload?.parts) ? payload.parts.length : 0} mode=full role=${role} actions=${completedActions.length}`);
    if (executionParts.length > 0) {
      await logger.info(`opencode ${role} execution parts ${JSON.stringify(executionParts)}`);
    }
    return { rawText, usedNativeExecution: completedActions.length > 0, completedActions };
  }

  private async promptSessionForLightText(sessionId: string, text: string, attachments: AiAttachment[], role?: PromptRole): Promise<string> {
    const startedAt = Date.now();
    await logger.info(`opencode text prompt start sessionId=${sessionId} model=${JSON.stringify(state.model || "default")} textChars=${text.length} attachments=${attachments.length} mode=light${role ? ` role=${role}` : ""}`);
    const response = await this.client.session.prompt({
      path: { id: sessionId },
      body: {
        agent: role === "assistant" ? "build" : undefined,
        system: role ? this.systemPromptForRole(role) : undefined,
        model: parseModel(state.model) || undefined,
        parts: this.buildParts(text, attachments),
      },
    }) as any;
    const payload = response.data ?? response;
    const rawText = extractText(payload).trim();
    await logger.info(`opencode text prompt response ms=${Date.now() - startedAt} sessionId=${sessionId} rawChars=${rawText.length} parts=${Array.isArray(payload?.parts) ? payload.parts.length : 0} mode=light`);
    if (!rawText) throw new Error("OpenCode returned no text output.");
    return rawText;
  }

  private async extractCompletedActionsFromSessionHistory(sessionId: string, payload: unknown): Promise<string[]> {
    const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : null;
    const info = record?.info && typeof record.info === "object" ? record.info as Record<string, unknown> : null;
    const parentId = typeof info?.parentID === "string" ? info.parentID.trim() : "";
    if (!parentId) return [];
    try {
      const response = await this.client.session.messages({ path: { id: sessionId } }) as any;
      const messages = response.data ?? response;
      const names = this.extractCompletedActionsFromMessages(messages, parentId);
      if (names.length > 0) {
        await logger.info(`opencode assistant recovered execution history parentId=${parentId} actions=${JSON.stringify(names)}`);
      }
      return names;
    } catch (error) {
      await logger.warn(`failed to recover assistant execution history sessionId=${sessionId} message=${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private extractCompletedActionsFromMessages(messages: unknown, parentId: string): string[] {
    if (!Array.isArray(messages) || !parentId) return [];
    const names: string[] = [];
    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      const record = message as Record<string, unknown>;
      const info = record.info && typeof record.info === "object" ? record.info as Record<string, unknown> : null;
      if (!info || info.role !== "assistant") continue;
      if ((typeof info.parentID === "string" ? info.parentID.trim() : "") !== parentId) continue;
      names.push(...this.extractCompletedActions(record.parts));
    }
    return names;
  }

  private extractCompletedActions(parts: unknown): string[] {
    if (!Array.isArray(parts)) return [];
    const names: string[] = [];
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const record = part as Record<string, unknown>;
      if (record.type !== "tool") continue;
      const tool = typeof record.tool === "string" ? record.tool.trim() : "";
      const stateRecord = record.state && typeof record.state === "object" ? record.state as Record<string, unknown> : null;
      const status = stateRecord && typeof stateRecord.status === "string" ? stateRecord.status.trim() : "";
      if (tool && status === "completed") names.push(tool);
    }
    return names;
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
    await logger.info(`${label} result message=${JSON.stringify(parsed.message)} files=${JSON.stringify(parsed.files)} fileWrites=${parsed.fileWrites.length} schedules=${parsed.schedules.length} deliveries=${parsed.deliveries.length} pendingAuthorizations=${parsed.pendingAuthorizations.length} tasks=${parsed.tasks.length}`);
  }
}
