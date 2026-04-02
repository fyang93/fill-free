import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@mariozechner/pi-coding-agent";
import { existsSync, readdirSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import type { AppConfig, PromptAttachment, UploadedFile } from "../types";
import { logger } from "../logger";
import { loadAvailableProjectSkills } from "../skills";
import { replyLanguageName } from "../i18n";
import { describePromptPreferences } from "../preferences";
import { state, touchActivity } from "../state";
import { STARTUP_GREETING_REQUEST, buildProjectSystemPrompt, buildPrompt, type PromptAccessRole } from "./prompt";
import { extractPromptResultFromText, looksLikeStructuredOutputIntent } from "./response";
import type { PromptResult } from "./types";

export type { PromptResult } from "./types";

type SessionEntry = {
  session: AgentSession;
  modelKey: string | null;
};

function ensureBotMcpConfigArgv(mcpConfigPath: string): void {
  const flag = "--mcp-config";
  const index = process.argv.indexOf(flag);
  if (index >= 0) {
    if (process.argv[index + 1] !== mcpConfigPath) {
      process.argv[index + 1] = mcpConfigPath;
    }
    return;
  }
  process.argv.push(flag, mcpConfigPath);
}

function parseDataUri(dataUri: string): { mediaType: string; data: string } | null {
  const match = dataUri.match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.*)$/s);
  if (!match) return null;
  return {
    mediaType: match[1],
    data: match[2],
  };
}

export class AgentService {
  private config: AppConfig;
  private readonly agentDir;
  private readonly authStorage;
  private readonly modelRegistry;
  private readonly settingsManager;
  private readonly resourceLoader;
  private readonly sessions = new Map<string, SessionEntry>();
  private readonly resourceWatchers: FSWatcher[] = [];
  private resourceReloadTimer: NodeJS.Timeout | null = null;
  private ready: Promise<void> | null = null;

  constructor(config: AppConfig) {
    this.config = config;
    this.agentDir = path.join(config.paths.repoRoot, ".pi", "bot");
    ensureBotMcpConfigArgv(path.join(this.agentDir, "mcp.json"));
    this.authStorage = AuthStorage.create(path.join(this.agentDir, "auth.json"));
    this.modelRegistry = ModelRegistry.create(this.authStorage, path.join(this.agentDir, "models.json"));
    this.settingsManager = SettingsManager.create(config.paths.repoRoot, this.agentDir);
    this.resourceLoader = new DefaultResourceLoader({
      cwd: config.paths.repoRoot,
      agentDir: this.agentDir,
      settingsManager: this.settingsManager,
      additionalExtensionPaths: [
        path.join(config.paths.repoRoot, "node_modules", "pi-web-access", "index.ts"),
        path.join(config.paths.repoRoot, "node_modules", "pi-mcp-adapter", "index.ts"),
      ],
      additionalSkillPaths: [path.join(config.paths.repoRoot, "node_modules", "pi-web-access", "skills")],
      appendSystemPromptOverride: (base) => [...base, buildProjectSystemPrompt()],
    });
    this.startResourceWatchers();
  }

  reloadConfig(config: AppConfig): void {
    this.config = config;
  }

  private async reloadResources(): Promise<void> {
    this.startResourceWatchers();
    await this.resourceLoader.reload();
    const loadedSkills = this.resourceLoader.getSkills().skills;
    const projectSkills = loadAvailableProjectSkills();
    await logger.info(`pi resource loader skills loaded=${loadedSkills.length} projectSkillsListed=${projectSkills.length} names=${JSON.stringify(loadedSkills.map((skill) => skill.name))}`);
  }

  private scheduleResourceReload(reason: string): void {
    if (this.resourceReloadTimer) clearTimeout(this.resourceReloadTimer);
    void logger.info(`detected skill change; reloading pi resources path=${reason}`);
    this.resourceReloadTimer = setTimeout(() => {
      const pending = this.reloadResources()
        .then(() => logger.info(`reloaded pi resources after ${reason}`))
        .catch((error) => logger.warn(`failed to reload pi resources after ${reason}: ${error instanceof Error ? error.message : String(error)}`));
      this.ready = pending;
    }, 250);
  }

  private watchPath(targetPath: string): void {
    if (!existsSync(targetPath)) return;
    try {
      const watcher = watch(targetPath, () => {
        this.scheduleResourceReload(targetPath);
      });
      this.resourceWatchers.push(watcher);
    } catch {
      return;
    }
  }

  private startResourceWatchers(): void {
    for (const watcher of this.resourceWatchers) {
      watcher.close();
    }
    this.resourceWatchers.length = 0;
    const projectSkillsDir = path.join(this.config.paths.repoRoot, ".agents", "skills");
    this.watchPath(projectSkillsDir);
    if (existsSync(projectSkillsDir)) {
      for (const entry of readdirSync(projectSkillsDir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          this.watchPath(path.join(projectSkillsDir, entry.name));
        }
      }
    }
  }

  async ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = this.reloadResources();
    }
    await this.ready;
    const available = await this.modelRegistry.getAvailable();
    if (available.length > 0) return;
    throw new Error("No pi models are available. Configure .pi/bot/models.json and make sure credentials are available.");
  }

  private sessionKey(scopeKey?: string): string {
    return scopeKey?.trim() || "global";
  }

  private selectedModelKey(): string | null {
    return typeof state.model === "string" && state.model.trim() ? state.model.trim() : null;
  }

  private async resolveSelectedModel() {
    const available = await this.modelRegistry.getAvailable();

    const matchModel = (providerID: string | undefined, modelID: string | undefined) => {
      if (!providerID || !modelID) return null;
      return available.find((model) => model.provider === providerID && model.id === modelID) || null;
    };

    const selected = this.selectedModelKey();
    if (selected) {
      const [providerID, ...rest] = selected.split("/");
      const modelID = rest.join("/").trim();
      const exact = matchModel(providerID, modelID);
      if (exact) {
        await logger.info(`pi model selection source=state model=${providerID}/${modelID}`);
        return exact;
      }
      await logger.warn(`pi state model ${selected} is unavailable; falling back to configured defaults`);
    }

    const defaultProvider = this.settingsManager.getDefaultProvider()?.trim();
    const defaultModel = this.settingsManager.getDefaultModel()?.trim();
    const configuredDefault = matchModel(defaultProvider, defaultModel);
    if (configuredDefault) {
      await logger.info(`pi model selection source=settings model=${defaultProvider}/${defaultModel}`);
      return configuredDefault;
    }
    if (defaultProvider || defaultModel) {
      await logger.warn(`pi configured default model is unavailable provider=${JSON.stringify(defaultProvider || "")} model=${JSON.stringify(defaultModel || "")}; falling back to first available model`);
    }

    const fallback = available[0] || null;
    if (fallback) {
      await logger.warn(`pi model selection source=fallback model=${fallback.provider}/${fallback.id}`);
    }
    return fallback;
  }

  private async createSession(scopeKey?: string): Promise<SessionEntry> {
    await this.ensureReady();
    const model = await this.resolveSelectedModel();
    const { session } = await createAgentSession({
      cwd: this.config.paths.repoRoot,
      agentDir: this.agentDir,
      resourceLoader: this.resourceLoader,
      sessionManager: SessionManager.inMemory(),
      settingsManager: this.settingsManager,
      authStorage: this.authStorage,
      modelRegistry: this.modelRegistry,
      model: model || undefined,
    });
    return {
      session,
      modelKey: model ? `${model.provider}/${model.id}` : null,
    };
  }

  private async getOrCreateSession(scopeKey?: string): Promise<SessionEntry> {
    const key = this.sessionKey(scopeKey);
    let entry = this.sessions.get(key);
    if (!entry) {
      entry = await this.createSession(scopeKey);
      this.sessions.set(key, entry);
      return entry;
    }

    const selectedModelKey = this.selectedModelKey();
    if (selectedModelKey && selectedModelKey !== entry.modelKey) {
      const model = await this.resolveSelectedModel();
      if (model) {
        await entry.session.setModel(model);
        entry.modelKey = `${model.provider}/${model.id}`;
      }
    }
    return entry;
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

  async newSession(scopeKey?: string, _scopeLabel?: string): Promise<string> {
    await this.disposeSession(scopeKey);
    const entry = await this.createSession(scopeKey);
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
    await this.ensureReady();
    const available = await this.modelRegistry.getAvailable();
    return {
      defaults: {},
      models: available.map((model) => `${model.provider}/${model.id}`).sort((a, b) => a.localeCompare(b)),
    };
  }

  async prompt(
    text: string,
    uploadedFiles: UploadedFile[] = [],
    attachments: PromptAttachment[] = [],
    telegramMessageTime?: string,
    scopeKey?: string,
    _scopeLabel?: string,
    accessRole: PromptAccessRole = "allowed",
  ): Promise<PromptResult> {
    const entry = await this.getOrCreateSession(scopeKey);
    const promptText = buildPrompt(
      text,
      uploadedFiles,
      this.config.bot.personaStyle,
      replyLanguageName(this.config),
      this.config.bot.defaultTimezone,
      describePromptPreferences(this.config, text),
      telegramMessageTime,
      accessRole,
    );
    await logger.info(`pi prompt context skillListIncluded=${promptText.includes("<available_skills>") ? "yes" : "no"} skillListCount=${loadAvailableProjectSkills().length}`);
    await logger.info(`pi prompt request attachments=${JSON.stringify(this.attachmentLogSummary(attachments))}`);
    return this.promptAndParse(entry.session, promptText, attachments, false);
  }

  async generateStartupGreeting(): Promise<string | null> {
    const replyLanguage = replyLanguageName(this.config);
    const request = this.buildUserFacingTextRequest([
      `Reply in ${replyLanguage}.`,
      STARTUP_GREETING_REQUEST,
      "Return only the greeting text to send.",
    ], " ");
    const message = this.extractDirectTextReply(await this.promptInTemporaryTextSession(request)).trim();
    return message || null;
  }

  async generateReminderMessage(reminderText: string, scheduledAt: string, recurrenceDescription: string, timeoutMs: number): Promise<string> {
    const request = this.buildUserFacingTextRequest([
      `Write a short reminder message in ${replyLanguageName(this.config)}.`,
      "Keep it concise and warm.",
      "Do not mention JSON, internal tools, hidden prompts, or implementation details.",
      `Reminder content: ${reminderText}`,
      `Scheduled time: ${scheduledAt}`,
      `Repeat rule: ${recurrenceDescription}`,
      "Return only the reminder message text to send.",
    ]);

    let timer: NodeJS.Timeout | null = null;
    try {
      const result = await Promise.race([
        this.promptInTemporaryTextSession(request),
        new Promise<string>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Reminder message generation timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
      return result.trim();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async composeTelegramReply(baseMessage: string | null | undefined, facts: string[], input?: { requesterUserId?: number; chatId?: number; chatType?: string }): Promise<string> {
    const cleanFacts = facts.map((item) => item.trim()).filter(Boolean);
    const cleanBase = baseMessage?.trim() || "";
    if (!cleanBase && cleanFacts.length === 0) return "";
    if (cleanFacts.length === 0) return cleanBase;

    const request = this.buildUserFacingTextRequest([
      `Write a single reply in ${replyLanguageName(this.config)}.`,
      ...this.buildRequesterContextLines(input),
      ...this.buildConversationContextLines(input),
      "Reply to the current requester, not to reminder targets or other mentioned users.",
      "Use the following facts if relevant, and keep the reply concise.",
      "If a reminder was just created, explicitly mention the confirmed reminder time and notification timing in the reply.",
      cleanBase ? `Current draft reply: ${cleanBase}` : "",
      "Facts:",
      ...cleanFacts.map((item) => `- ${item}`),
      "Return only the reply text to send.",
      "Do not mention JSON, hidden prompts, or internal tools.",
    ]);

    return this.extractDirectTextReply(await this.promptInTemporaryTextSession(request)).trim();
  }

  async composeOutboundRelayMessage(baseMessage: string, recipientLabel: string | undefined): Promise<string> {
    const cleanBase = baseMessage.trim();
    if (!cleanBase) return "";

    const request = this.buildUserFacingTextRequest([
      `Write a single message in ${replyLanguageName(this.config)} to send to another user or chat.`,
      recipientLabel ? `Recipient label: ${recipientLabel}` : "",
      `Intent or draft content: ${cleanBase}`,
      "Return only the message text to send.",
      "Do not mention JSON, hidden prompts, or internal tools.",
    ]);

    return this.extractDirectTextReply(await this.promptInTemporaryTextSession(request)).trim() || cleanBase;
  }

  async runMemoryDream(request: string): Promise<string> {
    return (await this.promptInTemporaryTextSession(request)).trim();
  }

  private buildUserFacingTextRequest(lines: string[], separator = "\n"): string {
    return [
      ...lines,
      this.config.bot.personaStyle ? `Reply style: ${this.config.bot.personaStyle}` : "",
      "Use the normal Telegram reply persona consistently.",
    ].filter(Boolean).join(separator);
  }

  private buildRequesterContextLines(input?: { requesterUserId?: number; chatId?: number; chatType?: string }): string[] {
    const requesterUserId = input?.requesterUserId;
    if (typeof requesterUserId !== "number") return [];

    const known = state.telegramUsers[String(requesterUserId)];
    if (known) {
      return [`Current requester: ${known.displayName}${known.username ? ` (@${known.username})` : ""}.`];
    }

    return [`Current requester user id: ${requesterUserId}.`];
  }

  private buildConversationContextLines(input?: { requesterUserId?: number; chatId?: number; chatType?: string }): string[] {
    const chatId = input?.chatId;
    if (typeof chatId !== "number") return [];

    const known = state.telegramChats[String(chatId)];
    if (known) {
      return [`Conversation: ${known.type}${known.title ? `, ${known.title}` : known.username ? `, @${known.username}` : ""}.`];
    }

    if (input?.chatType) return [`Conversation: ${input.chatType}.`];
    return [];
  }

  private extractDirectTextReply(rawText: string): string {
    const trimmed = rawText.trim();
    const normalizedQuotes = trimmed
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, '"')
      .replace(/[，]/g, ',')
      .replace(/[：]/g, ':');

    try {
      const parsed = JSON.parse(normalizedQuotes) as Record<string, unknown>;
      if (typeof parsed.message === "string" && parsed.message.trim()) {
        return parsed.message.trim();
      }
    } catch {
      // ignore JSON parse failures and fall back to plain text extraction
    }

    const match = trimmed.match(/(?:这会被[^：:\n]*[：:]|启动问候语[：:]|greeting text to send[\s:：]*|message text to send[\s:：]*|reply text to send[\s:：]*)\s*([\s\S]+)$/i);
    return match?.[1]?.trim() || trimmed;
  }

  stop(): void {
    if (this.resourceReloadTimer) {
      clearTimeout(this.resourceReloadTimer);
      this.resourceReloadTimer = null;
    }
    for (const watcher of this.resourceWatchers) {
      watcher.close();
    }
    this.resourceWatchers.length = 0;
    for (const entry of this.sessions.values()) {
      entry.session.dispose();
    }
    this.sessions.clear();
  }

  private imageInputs(attachments: PromptAttachment[]): Array<{ type: "image"; source: { type: "base64"; mediaType: string; data: string } }> {
    return attachments
      .filter((attachment) => attachment.mimeType.startsWith("image/") && attachment.url.startsWith("data:"))
      .map((attachment) => {
        const parsed = parseDataUri(attachment.url);
        if (!parsed) return null;
        return {
          type: "image" as const,
          source: {
            type: "base64" as const,
            mediaType: parsed.mediaType,
            data: parsed.data,
          },
        };
      })
      .filter((item): item is { type: "image"; source: { type: "base64"; mediaType: string; data: string } } => Boolean(item));
  }

  private async promptInTemporaryTextSession(text: string): Promise<string> {
    await this.ensureReady();
    const entry = await this.createSession();
    try {
      await logger.info("pi temporary text prompt request");
      const rawText = await this.promptSessionForText(entry.session, text, []);
      touchActivity();
      await logger.info(`pi temporary text prompt raw=${JSON.stringify(rawText)}`);
      return rawText;
    } finally {
      entry.session.dispose();
    }
  }

  private async promptAndParse(session: AgentSession, text: string, attachments: PromptAttachment[], temporary: boolean): Promise<PromptResult> {
    const rawText = await this.promptSessionForText(session, text, attachments);
    touchActivity();
    const parsed = extractPromptResultFromText(rawText);
    await this.logParsedPromptResult(rawText, parsed, temporary, false);

    if (parsed.message.trim() || parsed.files.length > 0 || parsed.reminders.length > 0 || parsed.outboundMessages.length > 0 || parsed.pendingAuthorizations.length > 0) {
      if (!this.shouldRepairStructuredOutput(rawText, parsed)) {
        return parsed;
      }
    } else {
      throw new Error("Model returned no displayable output.");
    }

    await logger.warn(`${temporary ? "pi temporary prompt" : "pi prompt"} returned malformed structured output; requesting one repair pass`);
    return this.requestStructuredOutputRepair(session, rawText, temporary);
  }

  private async promptSessionForText(session: AgentSession, text: string, attachments: PromptAttachment[]): Promise<string> {
    let currentText = "";
    let finalText = "";
    let lastProviderError: string | null = null;
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_start") {
        currentText = "";
        return;
      }
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        currentText += event.assistantMessageEvent.delta;
        return;
      }
      if (event.type === "message_end") {
        if (currentText.trim()) finalText = currentText.trim();
        const message = "message" in event ? event.message as { stopReason?: string; errorMessage?: string } : undefined;
        if (message?.stopReason === "error" && message.errorMessage?.trim()) {
          lastProviderError = message.errorMessage.trim();
          void logger.warn(`pi provider error: ${lastProviderError}`);
        }
        return;
      }
      if (event.type === "auto_retry_start") {
        lastProviderError = event.errorMessage;
        void logger.warn(`pi auto-retry starting attempt=${event.attempt}/${event.maxAttempts} delayMs=${event.delayMs} error=${JSON.stringify(event.errorMessage)}`);
        return;
      }
      if (event.type === "auto_retry_end" && !event.success) {
        const finalError = event.finalError?.trim();
        if (finalError) lastProviderError = finalError;
        void logger.warn(`pi auto-retry failed attempt=${event.attempt} error=${JSON.stringify(finalError || "unknown")}`);
        return;
      }
      if (event.type === "compaction_end" && event.errorMessage?.trim()) {
        void logger.warn(`pi compaction error: ${event.errorMessage.trim()}`);
      }
    });

    try {
      const images = this.imageInputs(attachments);
      await session.prompt(text, images.length > 0 ? { images } as never : undefined);
    } catch (error) {
      const message = error instanceof Error ? error.stack || error.message : String(error);
      await logger.error(`pi session prompt failed: ${message}`);
      throw error;
    } finally {
      unsubscribe();
    }

    const result = finalText || currentText.trim();
    if (!result && lastProviderError) {
      await logger.warn(`pi prompt completed without text output; last provider error=${JSON.stringify(lastProviderError)}`);
      throw new Error(lastProviderError);
    }
    if (!result) {
      throw new Error("Model returned no text output.");
    }
    return result;
  }

  private shouldRepairStructuredOutput(rawText: string, parsed: PromptResult): boolean {
    if (!looksLikeStructuredOutputIntent(rawText)) return false;
    const hasStructuredData = parsed.files.length > 0 || parsed.reminders.length > 0 || parsed.outboundMessages.length > 0 || parsed.pendingAuthorizations.length > 0;
    if (hasStructuredData) return false;
    return parsed.message === rawText.trim();
  }

  private async requestStructuredOutputRepair(session: AgentSession, previousRawText: string, temporary: boolean): Promise<PromptResult> {
    const repairInstruction = [
      "Your previous reply was intended to be structured output, but it did not match the required schema.",
      "Rewrite it now as exactly one valid JSON object and nothing else.",
      "Do not use Markdown code fences.",
      'Include all top-level fields exactly: {"message": string, "files": string[], "reminders": [], "outboundMessages": [], "pendingAuthorizations": []}.',
      "Use empty string or empty arrays for fields with no content.",
      "Preserve the original intent and content.",
      `Previous reply: ${previousRawText}`,
    ].join("\n");

    const rawText = await this.promptSessionForText(session, repairInstruction, []);
    touchActivity();
    const parsed = extractPromptResultFromText(rawText);
    await this.logParsedPromptResult(rawText, parsed, temporary, true);
    return parsed;
  }

  private attachmentLogSummary(attachments: PromptAttachment[]): Array<{ mimeType: string; filename?: string; urlScheme: string }> {
    return attachments.map((item) => ({
      mimeType: item.mimeType,
      filename: item.filename,
      urlScheme: item.url.startsWith("data:") ? "data" : "remote",
    }));
  }

  private async logParsedPromptResult(rawText: string, parsed: PromptResult, temporary: boolean, repaired: boolean): Promise<void> {
    const label = temporary ? "pi temporary prompt" : "pi prompt";
    await logger.info(`${label}${repaired ? " repair" : ""} raw=${JSON.stringify(rawText)}`);
    if (parsed.files.length === 0 && parsed.attachments.length === 0 && parsed.reminders.length === 0 && parsed.outboundMessages.length === 0 && parsed.pendingAuthorizations.length === 0 && parsed.message === (rawText.trim() || "Done.")) {
      await logger.warn(`${label}${repaired ? " repair" : ""} did not return valid JSON; using plain-text fallback`);
    }
    if (parsed.reminders.length === 0 && /"reminders"\s*:/i.test(rawText) && !/"reminders"\s*:\s*\[\s*\]/i.test(rawText)) {
      await logger.warn(`${label}${repaired ? " repair" : ""} included a reminders field, but no valid reminder objects were parsed`);
    }
    if (parsed.outboundMessages.length === 0 && /"outboundMessages"\s*:/i.test(rawText) && !/"outboundMessages"\s*:\s*\[\s*\]/i.test(rawText)) {
      await logger.warn(`${label}${repaired ? " repair" : ""} included an outboundMessages field, but no valid outbound message objects were parsed`);
    }
    if (parsed.pendingAuthorizations.length === 0 && /"pendingAuthorizations"\s*:/i.test(rawText) && !/"pendingAuthorizations"\s*:\s*\[\s*\]/i.test(rawText)) {
      await logger.warn(`${label}${repaired ? " repair" : ""} included a pendingAuthorizations field, but no valid pending authorization objects were parsed`);
    }
    await logger.info(`${label}${repaired ? " repair" : ""} result message=${JSON.stringify(parsed.message)} files=${JSON.stringify(parsed.files)} reminders=${JSON.stringify(parsed.reminders.map((item) => ({ title: item.title, kind: item.kind, timeSemantics: item.timeSemantics, targetUsers: item.targetUsers, targetUser: item.targetUser })))} outboundMessages=${JSON.stringify(parsed.outboundMessages.map((item) => ({ message: item.message, targetUsers: item.targetUsers, targetUser: item.targetUser })))} attachments=${JSON.stringify(parsed.attachments.map((item) => ({ mimeType: item.mimeType, filename: item.filename })))} pendingAuthorizations=${JSON.stringify(parsed.pendingAuthorizations)}`);
  }
}
