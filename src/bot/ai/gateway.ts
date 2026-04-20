import path from "node:path";
import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
} from "@mariozechner/pi-coding-agent";
import type { ImageContent, Model } from "@mariozechner/pi-ai";
import type { AppConfig, AiAttachment, UploadedFile } from "bot/app/types";
import { logger } from "bot/app/logger";
import { formatIsoInTimezoneParts } from "bot/app/time";
import { state, touchActivity } from "bot/app/state";
import { buildAccessConstraintLines, buildProjectSystemPrompt, type RequestAccessRole } from "./prompt";
import { emptyTurnResult, extractAiTurnResultFromText } from "./response";
import type { AiTurnResult, AssistantPlanResult, AssistantProgressHandler } from "./types";
import { ReplyComposer, type ReplyComposerInputContext } from "./reply-composer";
import { StructuredReasoner } from "./structured-reasoner";

export type { AiTurnResult } from "./types";

type PromptRole = "assistant" | "maintainer" | "writer";

type SessionEntry = {
  session: AgentSession;
  modelKey: string;
};

type SdkRuntime = {
  authStorage: AuthStorage;
  modelRegistry: ModelRegistry;
  settingsManager: SettingsManager;
  assistantLoader: DefaultResourceLoader;
  writerLoader: DefaultResourceLoader;
  maintainerLoader: DefaultResourceLoader;
};

type MockPromptPayload = {
  parts?: Array<{ type?: string; text?: string }>;
  info?: { parentID?: string };
};

function assistantTextFromMessages(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message || typeof message !== "object") continue;
    const record = message as { role?: string; content?: Array<{ type?: string; text?: string }> | string };
    if (record.role !== "assistant") continue;
    if (typeof record.content === "string") return record.content.trim();
    if (!Array.isArray(record.content)) return "";
    return record.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text?.trim())
      .filter(Boolean)
      .join("\n\n");
  }
  return "";
}

function parseImageAttachment(attachment: AiAttachment): ImageContent | null {
  if (!attachment.mimeType.startsWith("image/")) return null;
  const match = attachment.url.match(/^data:([^;,]+);base64,(.*)$/s);
  if (!match) return null;
  const [, mimeType, data] = match;
  return {
    type: "image",
    mimeType,
    data,
  };
}

function modelKey(model: Model<any> | undefined): string {
  return model ? `${model.provider}/${model.id}` : "default";
}

function extractTextFromMockPayload(payload: MockPromptPayload | null | undefined): string {
  return Array.isArray(payload?.parts)
    ? payload.parts
        .filter((part) => part?.type === "text" && typeof part.text === "string")
        .map((part) => part.text?.trim())
        .filter(Boolean)
        .join("\n\n")
    : "";
}

function summarizeMockCompletedActions(parts: unknown): string[] {
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

export class AiService {
  private config: AppConfig;
  private client: any = null;
  private runtime: SdkRuntime | null = null;
  private runtimePromise: Promise<SdkRuntime> | null = null;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly replyComposer: ReplyComposer;
  private readonly structuredReasoner: StructuredReasoner;

  constructor(config: AppConfig) {
    this.config = config;
    this.replyComposer = new ReplyComposer(
      config,
      (text) => this.promptInDisposableTextSession("writer", text),
      (text) => this.promptInDisposableTextSession("writer", text),
    );
    this.structuredReasoner = new StructuredReasoner(config, async (promptText, attachments, scopeKey) => {
      const result = await this.runAssistantProtocol(promptText, attachments, { scopeKey });
      return {
        message: result.message,
        files: result.files || [],
        attachments: result.attachments || [],
      };
    }, (attachments) => this.attachmentLogSummary(attachments));
  }

  reloadConfig(config: AppConfig): void {
    this.config = config;
    this.replyComposer.updateConfig(config);
    this.structuredReasoner.updateConfig(config);
    this.stop();
    this.runtime = null;
    this.runtimePromise = null;
  }

  async ensureReady(): Promise<void> {
    const startedAt = Date.now();
    if (this.client?.path?.get) {
      await this.client.path.get();
      await logger.info(`mock ai gateway ready ms=${Date.now() - startedAt}`);
      return;
    }
    const { models } = await this.listModels();
    if (models.length === 0) {
      throw new Error("pi SDK has no available models. Configure OPENAI_API_KEY and/or OPENROUTER_API_KEY first.");
    }
    await logger.info(`pi sdk ready ms=${Date.now() - startedAt} models=${models.length} repoRoot=${this.config.paths.repoRoot}`);
  }

  private agentDir(): string {
    return path.join(this.config.paths.repoRoot, ".pi-agent");
  }

  private createLoader(role: PromptRole, settingsManager: SettingsManager): DefaultResourceLoader {
    return new DefaultResourceLoader({
      cwd: this.config.paths.repoRoot,
      agentDir: this.agentDir(),
      settingsManager,
      systemPromptOverride: () => buildProjectSystemPrompt(this.config.bot.personaStyle, role),
      appendSystemPromptOverride: () => [],
    });
  }

  private async ensureSdkRuntime(): Promise<SdkRuntime> {
    if (this.runtime) return this.runtime;
    if (this.runtimePromise) return this.runtimePromise;

    this.runtimePromise = (async () => {
      const authStorage = AuthStorage.create();
      const modelRegistry = ModelRegistry.create(authStorage);
      const settingsManager = SettingsManager.inMemory();
      const assistantLoader = this.createLoader("assistant", settingsManager);
      const writerLoader = this.createLoader("writer", settingsManager);
      const maintainerLoader = this.createLoader("maintainer", settingsManager);
      await Promise.all([assistantLoader.reload(), writerLoader.reload(), maintainerLoader.reload()]);
      const runtime = {
        authStorage,
        modelRegistry,
        settingsManager,
        assistantLoader,
        writerLoader,
        maintainerLoader,
      };
      this.runtime = runtime;
      return runtime;
    })();

    try {
      return await this.runtimePromise;
    } finally {
      this.runtimePromise = null;
    }
  }

  // Built-in providers already know their model catalogs.
  // Per docs/providers.md, API-key providers such as OpenAI are enabled
  // through environment variables or auth.json; no custom provider
  // registration is needed unless we are overriding endpoints/models.

  private selectedModel(runtime: SdkRuntime): Model<any> | undefined {
    const configured = state.model?.trim();
    if (!configured) return undefined;
    const index = configured.indexOf("/");
    if (index <= 0 || index === configured.length - 1) return undefined;
    return runtime.modelRegistry.find(configured.slice(0, index), configured.slice(index + 1));
  }

  private sessionKey(scopeKey?: string): string {
    return scopeKey?.trim() || "global";
  }

  private async createSession(role: PromptRole, scopeKey?: string, _scopeLabel?: string): Promise<SessionEntry> {
    if (this.client?.session?.create) {
      const response = await this.client.session.create({ body: { title: scopeKey || role } });
      const sessionId = response?.data?.id || response?.id || `${role}-${Date.now()}`;
      const mockSession = {
        sessionId,
        messages: [],
        subscribe: () => () => {},
        abort: async () => {},
        dispose: () => {},
      } as unknown as AgentSession;
      return { session: mockSession, modelKey: state.model || "default" };
    }
    const runtime = await this.ensureSdkRuntime();
    const configuredModel = state.model?.trim() || null;
    const model = this.selectedModel(runtime);
    if (configuredModel && !model) {
      throw new Error(`Configured model is unavailable in pi SDK: ${configuredModel}`);
    }
    const loader = role === "assistant" ? runtime.assistantLoader : role === "writer" ? runtime.writerLoader : runtime.maintainerLoader;
    const { session } = await createAgentSession({
      cwd: this.config.paths.repoRoot,
      agentDir: this.agentDir(),
      authStorage: runtime.authStorage,
      modelRegistry: runtime.modelRegistry,
      settingsManager: runtime.settingsManager,
      resourceLoader: loader,
      sessionManager: SessionManager.inMemory(),
      model,
      tools: role === "assistant" ? undefined : [],
    });
    await logger.info(`pi session created role=${role} scope=${JSON.stringify(scopeKey || "global")} sessionId=${session.sessionId} model=${JSON.stringify(modelKey(model))}`);
    return { session, modelKey: modelKey(model) };
  }

  private async getOrCreateSession(scopeKey?: string, scopeLabel?: string): Promise<SessionEntry> {
    const runtime = await this.ensureSdkRuntime();
    const desiredModelKey = modelKey(this.selectedModel(runtime));
    const key = this.sessionKey(scopeKey);
    const existing = this.sessions.get(key);
    if (existing && existing.modelKey === desiredModelKey) return existing;
    if (existing) {
      await existing.session.abort().catch(() => {});
      existing.session.dispose();
      this.sessions.delete(key);
    }
    const created = await this.createSession("assistant", scopeKey, scopeLabel);
    this.sessions.set(key, created);
    return created;
  }

  private async disposeSession(scopeKey?: string): Promise<boolean> {
    const key = this.sessionKey(scopeKey);
    const entry = this.sessions.get(key);
    if (!entry) return false;
    try {
      await entry.session.abort().catch(() => {});
    } finally {
      entry.session.dispose();
      this.sessions.delete(key);
    }
    return true;
  }

  async newSession(scopeKey?: string, scopeLabel?: string): Promise<string> {
    await this.disposeSession(scopeKey);
    const entry = await this.createSession("assistant", scopeKey, scopeLabel);
    this.sessions.set(this.sessionKey(scopeKey), entry);
    touchActivity();
    return entry.session.sessionId;
  }

  async abortCurrentSession(scopeKey?: string, scopeLabel?: string): Promise<boolean> {
    const aborted = await this.disposeSession(scopeKey);
    if (aborted) {
      await logger.warn(`aborted pi session${scopeLabel ? ` for ${scopeLabel}` : ""}`);
      touchActivity();
    }
    return aborted;
  }

  async listModels(): Promise<{ defaults: Record<string, string>; models: string[] }> {
    const runtime = await this.ensureSdkRuntime();
    const available = await runtime.modelRegistry.getAvailable();
    const models = available
      .map((model) => `${model.provider}/${model.id}`)
      .sort((a, b) => a.localeCompare(b));

    return {
      defaults: {},
      models,
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

  async generateReminderText(reminderText: string, notifyAt: string, recurrenceDescription: string, timezone: string): Promise<string> {
    return this.replyComposer.generateReminderText(reminderText, notifyAt, recurrenceDescription, timezone);
  }

  async generateScheduledTaskContent(prompt: string): Promise<string> {
    const taskPrompt = prompt.trim();
    if (!taskPrompt) return "";
    const request = [
      "Generate fresh, useful content for this recurring automated task.",
      `Task prompt: ${taskPrompt}`,
    ].join("\n");
    const result = await this.runAssistantProtocol(request, [], {});
    return result.message.trim();
  }

  async composeUserReply(baseMessage: string | null | undefined, facts: string[], input?: ReplyComposerInputContext): Promise<string> {
    return this.replyComposer.composeUserReply(baseMessage, facts, input);
  }

  async runMaintenancePass(request: string): Promise<string> {
    return (await this.promptInDisposableTextSession("maintainer", request)).trim();
  }

  async runAssistantTurn(input: {
    userRequestText: string;
    requesterUserId?: number;
    chatId?: number;
    chatType?: string;
    accessRole: RequestAccessRole;
    uploadedFiles?: UploadedFile[];
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
      `Requester user id: ${input.requesterUserId ?? "unknown"}`,
      `Chat id: ${input.chatId ?? "unknown"}`,
      `Chat type: ${input.chatType || "unknown"}`,
      "Default visible output to the current chat unless the user asked otherwise.",
      localMessageTime ? `Local time: ${localMessageTime.localDateTime} (${localMessageTime.timezone}).` : "",
      ...buildAccessConstraintLines(input.accessRole),
      input.sharedConversationContextText?.trim() ? "Context:" : "",
      input.sharedConversationContextText?.trim() || "",
      input.uploadedFiles && input.uploadedFiles.length > 0 ? "Files:" : "",
      ...(input.uploadedFiles || []).map((file) => `- ${file.savedPath} (${file.mimeType}, ${Math.ceil(file.sizeBytes / 1024)} KB)`),
      input.userRequestText.trim() ? `Request: ${input.userRequestText.trim()}` : "",
    ].filter(Boolean).join("\n");

    return this.runAssistantProtocol(prompt, input.attachments || [], {
      scopeKey: input.scopeKey,
      scopeLabel: input.scopeLabel,
      isTaskCurrent: input.isTaskCurrent,
      onProgress: input.onProgress,
    });
  }

  stop(): void {
    for (const entry of this.sessions.values()) {
      entry.session.dispose();
    }
    this.sessions.clear();
  }

  private systemPromptForRole(role: PromptRole): string {
    return buildProjectSystemPrompt(this.config.bot.personaStyle, role);
  }

  private buildMockBody(text: string, attachments: AiAttachment[], role?: PromptRole): Record<string, unknown> {
    const parts: Array<Record<string, unknown>> = [{ type: "text", text }];
    for (const attachment of attachments) {
      parts.push({ type: "file", mime: attachment.mimeType, filename: attachment.filename, url: attachment.url });
    }
    return {
      agent: role === "assistant" ? "build" : undefined,
      system: role ? this.systemPromptForRole(role) : undefined,
      model: state.model || undefined,
      parts,
    };
  }

  private async runMockPrompt(sessionId: string, text: string, attachments: AiAttachment[], role?: PromptRole): Promise<{ rawText: string; completedActions: string[] }> {
    const response = await this.client.session.prompt({
      path: { id: sessionId },
      body: this.buildMockBody(text, attachments, role),
    });
    const payload = (response?.data ?? response) as MockPromptPayload;
    const rawText = extractTextFromMockPayload(payload).trim();
    const directCompletedActions = summarizeMockCompletedActions(payload?.parts);
    const completedActions = directCompletedActions.length > 0
      ? directCompletedActions
      : await this.extractCompletedActionsFromMockSessionHistory(sessionId, payload);
    return { rawText, completedActions };
  }

  private async extractCompletedActionsFromMockSessionHistory(sessionId: string, payload: MockPromptPayload | null | undefined): Promise<string[]> {
    const parentId = typeof payload?.info?.parentID === "string" ? payload.info.parentID.trim() : "";
    if (!parentId || !this.client?.session?.messages) return [];
    try {
      const response = await this.client.session.messages({ path: { id: sessionId } });
      const messages = response?.data ?? response;
      if (!Array.isArray(messages)) return [];
      const names: string[] = [];
      for (const message of messages) {
        if (!message || typeof message !== "object") continue;
        const record = message as Record<string, unknown>;
        const info = record.info && typeof record.info === "object" ? record.info as Record<string, unknown> : null;
        if ((typeof info?.parentID === "string" ? info.parentID.trim() : "") !== parentId) continue;
        names.push(...summarizeMockCompletedActions(record.parts));
      }
      return Array.from(new Set(names));
    } catch {
      return [];
    }
  }

  private imagesFromAttachments(attachments: AiAttachment[]): ImageContent[] {
    return attachments.map(parseImageAttachment).filter((item): item is ImageContent => Boolean(item));
  }

  private async runPromptOnSession(
    session: AgentSession | string,
    text: string,
    attachments: AiAttachment[],
    role?: PromptRole,
    onProgress?: AssistantProgressHandler,
  ): Promise<{ rawText: string; completedActions: string[] }> {
    const startedAt = Date.now();
    const sessionId = typeof session === "string" ? session : session.sessionId;
    if (this.client?.session?.prompt) {
      await logger.info(`pi text prompt start sessionId=${sessionId} model=${JSON.stringify(state.model || "default")} textChars=${text.length} attachments=${attachments.length}${role ? ` role=${role}` : ""}`);
      const response = await this.runMockPrompt(sessionId, text, attachments, role);
      await logger.info(`pi text prompt response ms=${Date.now() - startedAt} sessionId=${sessionId} rawChars=${response.rawText.trim().length} actions=${response.completedActions.length}${role ? ` role=${role}` : ""}`);
      if (response.completedActions.length > 0 && onProgress) {
        void Promise.resolve(onProgress("正在处理中…"));
      }
      return response;
    }

    const sdkSession = session as AgentSession;
    const images = this.imagesFromAttachments(attachments);
    let rawText = "";
    const completedActions: string[] = [];
    let progressSent = false;

    const unsubscribe = sdkSession.subscribe((event: AgentSessionEvent) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        rawText += event.assistantMessageEvent.delta;
      }
      if (event.type === "tool_execution_end" && !event.isError) {
        completedActions.push(event.toolName);
        if (!progressSent && onProgress) {
          progressSent = true;
          void Promise.resolve(onProgress("正在处理中…"));
        }
      }
    });

    try {
      await logger.info(`pi text prompt start sessionId=${sdkSession.sessionId} model=${JSON.stringify(state.model || "default")} textChars=${text.length} attachments=${attachments.length}${role ? ` role=${role}` : ""}`);
      await sdkSession.prompt(text, images.length > 0 ? { images } : undefined);
      if (!rawText.trim()) {
        rawText = assistantTextFromMessages(sdkSession.messages);
      }
      await logger.info(`pi text prompt response ms=${Date.now() - startedAt} sessionId=${sdkSession.sessionId} rawChars=${rawText.trim().length} actions=${completedActions.length}${role ? ` role=${role}` : ""}`);
      return { rawText: rawText.trim(), completedActions: Array.from(new Set(completedActions)) };
    } finally {
      unsubscribe();
    }
  }

  private async promptInDisposableTextSession(role: Exclude<PromptRole, "assistant">, text: string): Promise<string> {
    const entry = await this.createSession(role);
    try {
      await logger.info(`pi ${role} text prompt request`);
      const response = await this.runPromptOnSession(entry.session, text, [], role);
      if (response.completedActions.length > 0) {
        throw new Error(`${role} text generation must not execute tools`);
      }
      if (!response.rawText) throw new Error("pi SDK returned no text output.");
      touchActivity();
      await logger.info(`pi ${role} text prompt raw=${JSON.stringify(response.rawText)}`);
      return response.rawText;
    } finally {
      await entry.session.abort().catch(() => {});
      entry.session.dispose();
    }
  }

  private async promptInScopedAssistantSession(text: string, attachments: AiAttachment[], scopeKey?: string, scopeLabel?: string, onProgress?: AssistantProgressHandler): Promise<{ rawText: string; usedNativeExecution: boolean; completedActions: string[] }> {
    const entry = await this.getOrCreateSession(scopeKey, scopeLabel);
    await logger.info("pi assistant text prompt request");
    const response = await this.promptSessionForAgent(entry.session, text, attachments, "assistant", onProgress);
    touchActivity();
    await logger.info(`pi assistant text prompt raw=${JSON.stringify(response.rawText)}`);
    return response;
  }

  private async runAssistantProtocol(
    text: string,
    attachments: AiAttachment[],
    options?: { scopeKey?: string; scopeLabel?: string; isTaskCurrent?: () => boolean; onProgress?: AssistantProgressHandler },
  ): Promise<AssistantPlanResult> {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      if (options?.isTaskCurrent && !options.isTaskCurrent()) {
        await logger.warn("assistant agent prompt skipped because task is stale");
        return { ...emptyTurnResult(), usedNativeExecution: false, completedActions: [] };
      }
      const promptText = attempt === 1
        ? text
        : [text, "", "Previous output was not displayable.", "Return only the final user-visible reply."].join("\n");
      const response = await this.promptInScopedAssistantSession(promptText, attachments, options?.scopeKey, options?.scopeLabel, options?.onProgress);
      if (options?.isTaskCurrent && !options.isTaskCurrent()) {
        await logger.warn("assistant agent response ignored because task became stale");
        return { ...emptyTurnResult(), usedNativeExecution: false, completedActions: response.completedActions };
      }
      const parsed = extractAiTurnResultFromText(response.rawText.trim());
      if (parsed.message || parsed.files.length > 0 || parsed.attachments.length > 0) {
        return {
          ...parsed,
          usedNativeExecution: response.usedNativeExecution,
          completedActions: response.usedNativeExecution ? response.completedActions : [],
        };
      }
      await logger.warn(`discarded assistant output attempt=${attempt} reason=${response.usedNativeExecution ? "non-displayable" : "no-tools-and-no-displayable-text"}`);
    }
    throw new Error("Assistant output protocol violation: invalid turn result.");
  }

  async promptSessionForAssistant(session: AgentSession | string, text: string, attachments: AiAttachment[], onProgress?: AssistantProgressHandler): Promise<{ rawText: string; usedNativeExecution: boolean; completedActions: string[] }> {
    return this.promptSessionForAgent(session, text, attachments, "assistant", onProgress);
  }

  private async promptSessionForAgent(session: AgentSession | string, text: string, attachments: AiAttachment[], role: "assistant", onProgress?: AssistantProgressHandler): Promise<{ rawText: string; usedNativeExecution: boolean; completedActions: string[] }> {
    const response = await this.runPromptOnSession(session, text, attachments, role, onProgress);
    return {
      rawText: response.rawText,
      usedNativeExecution: response.completedActions.length > 0,
      completedActions: response.completedActions,
    };
  }

  private attachmentLogSummary(attachments: AiAttachment[]): Array<{ mimeType: string; filename?: string; urlScheme: string }> {
    return attachments.map((attachment) => ({
      mimeType: attachment.mimeType,
      filename: attachment.filename,
      urlScheme: attachment.url.startsWith("data:") ? "data" : attachment.url.startsWith("http") ? "http" : "other",
    }));
  }

}
