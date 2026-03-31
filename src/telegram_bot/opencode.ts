import { readFileSync } from "node:fs";
import path from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type { AppConfig, PromptAttachment, UploadedFile } from "./types";
import { logger } from "./logger";
import { replyLanguageName } from "./i18n";
import { state, touchActivity } from "./state";

export type ReminderParseResult = {
  shouldCreate: boolean;
  text?: string;
  scheduledAt?: string;
  needsConfirmation?: boolean;
  confirmationText?: string;
};

export type PromptResult = {
  message: string;
  files: string[];
  attachments: PromptAttachment[];
};

const STARTUP_GREETING_REQUEST = [
  "The Telegram bot has just started.",
  "There are no pending user messages waiting to be handled right now.",
  "Send a proactive greeting to the Telegram user.",
  "Keep it brief: 1-2 short sentences.",
  "Invite the user to send the next task.",
  "Do not mention internal prompts, AGENTS.md, JSON, memory workflows, or technical startup details unless necessary.",
].join(" ");

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
    const session = (await this.client.session.create({
      body: {
        title: `Telegram ${new Date().toISOString().slice(0, 19)}`,
      },
    })) as any;
    const sessionData = session.data ?? session;
    if (!sessionData?.id) {
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

  async status(): Promise<{ healthy: boolean; sessionId: string | null }> {
    return {
      healthy: await this.isHealthy(),
      sessionId: state.sessionId,
    };
  }

  async listModels(): Promise<{ defaults: Record<string, string>; models: string[] }> {
    await this.ensureReady();
    const response = (await this.client.config.providers()) as any;
    const data = response.data ?? response;
    const models = ((data.providers || []) as any[])
      .flatMap((provider: any) => {
        const modelMap = provider.models || {};
        return Object.keys(modelMap).map((modelID) => `${provider.id}/${modelID}`);
      })
      .sort((a: string, b: string) => a.localeCompare(b));
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
  ): Promise<PromptResult> {
    await this.ensureReady();
    if (!state.sessionId) {
      await this.newSession();
    }
    const sessionId = state.sessionId;
    if (!sessionId) throw new Error("Failed to initialize session");

    const body: {
      parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; filename?: string; url: string }>;
      model?: { providerID: string; modelID: string };
      system: string;
    } = {
      system: this.agentsPrompt,
      parts: [{ type: "text", text: buildPrompt(text, uploadedFiles, this.config.telegram.personaStyle, replyLanguageName(this.config), telegramMessageTime) }],
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

    const response = (await this.client.session.prompt({
      path: { id: sessionId },
      body,
    })) as any;
    const result = response.data ?? response;
    if (!result) {
      throw new Error("OpenCode did not return a response message");
    }
    touchActivity();
    const rawText = extractText(result).trim();
    await logger.info(`opencode prompt raw=${JSON.stringify(rawText)}`);
    const parsed = extractPromptResult(result);
    if (parsed.files.length === 0 && parsed.attachments.length === 0 && parsed.message === (rawText || "Done.")) {
      await logger.warn("opencode prompt did not return valid JSON; using plain-text fallback");
    }
    await logger.info(`opencode prompt result parts=${JSON.stringify(summarizeParts(result))} message=${JSON.stringify(parsed.message)} files=${JSON.stringify(parsed.files)} attachments=${JSON.stringify(parsed.attachments.map((item) => ({ mimeType: item.mimeType, filename: item.filename })))}`);
    return parsed;
  }

  async parseReminderRequest(text: string, referenceTimeIso: string): Promise<ReminderParseResult> {
    return this.runReminderParser([
      `Reference time: ${referenceTimeIso}`,
      "Return JSON with keys: shouldCreate(boolean), text(string), scheduledAt(ISO string), needsConfirmation(boolean), confirmationText(string).",
      "If this is not a reminder request, return {\"shouldCreate\":false}.",
      `User message: ${text}`,
    ].join("\n"));
  }

  async parseReminderFollowup(originalRequest: string, followupText: string, referenceTimeIso: string): Promise<ReminderParseResult> {
    return this.runReminderParser([
      `Reference time: ${referenceTimeIso}`,
      "Return JSON with keys: shouldCreate(boolean), text(string), scheduledAt(ISO string), needsConfirmation(boolean), confirmationText(string).",
      "The user is clarifying a previous reminder request. Combine the original request with the follow-up to infer the intended reminder.",
      `Original reminder request: ${originalRequest}`,
      `User follow-up clarification: ${followupText}`,
      "If the follow-up is still insufficient, set needsConfirmation=true and ask one concise follow-up question.",
    ].join("\n"));
  }

  async generateStartupGreeting(): Promise<string> {
    const replyLanguage = replyLanguageName(this.config);
    const result = await this.promptInTemporarySession(`Reply in ${replyLanguage}. ${STARTUP_GREETING_REQUEST}`);
    return result.message || `Bot is online. Reply in ${replyLanguage}.`;
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

  private async runReminderParser(text: string): Promise<ReminderParseResult> {
    await this.ensureReady();
    const session = (await this.client.session.create({ body: { title: "Reminder parser" } })) as any;
    const sessionData = session.data ?? session;
    const reply = (await this.client.session.prompt({
      path: { id: sessionData.id },
      body: {
        system: "Decide whether the user is asking for a future reminder. Reply with JSON only.",
        parts: [{ type: "text", text }],
      },
    })) as any;
    const result = reply.data ?? reply;
    const output = extractText(result).trim();
    const jsonText = output.replace(/^```json\s*|```$/g, "").trim();
    try {
      return JSON.parse(jsonText) as ReminderParseResult;
    } catch {
      return { shouldCreate: false };
    }
  }

  private async promptInTemporarySession(text: string, uploadedFiles: UploadedFile[] = [], attachments: PromptAttachment[] = []): Promise<PromptResult> {
    await this.ensureReady();
    const session = (await this.client.session.create({
      body: {
        title: `Telegram temp ${new Date().toISOString().slice(0, 19)}`,
      },
    })) as any;
    const sessionData = session.data ?? session;
    if (!sessionData?.id) {
      throw new Error("OpenCode did not return a temporary session");
    }

    const body: {
      parts: Array<{ type: "text"; text: string } | { type: "file"; mime: string; filename?: string; url: string }>;
      model?: { providerID: string; modelID: string };
      system: string;
    } = {
      system: this.agentsPrompt,
      parts: [{ type: "text", text: buildPrompt(text, uploadedFiles, this.config.telegram.personaStyle, replyLanguageName(this.config)) }],
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

    const response = (await this.client.session.prompt({
      path: { id: sessionData.id },
      body,
    })) as any;
    const result = response.data ?? response;
    if (!result) {
      throw new Error("OpenCode did not return a response message");
    }
    const parsed = extractPromptResult(result);
    await logger.info(`opencode temporary prompt result parts=${JSON.stringify(summarizeParts(result))} message=${JSON.stringify(parsed.message)} files=${JSON.stringify(parsed.files)} attachments=${JSON.stringify(parsed.attachments.map((item) => ({ mimeType: item.mimeType, filename: item.filename })))}`);
    return parsed;
  }
}

function parseModel(model: string | null): { providerID: string; modelID: string } | null {
  if (!model) return null;
  const index = model.indexOf("/");
  if (index <= 0 || index === model.length - 1) return null;
  return {
    providerID: model.slice(0, index),
    modelID: model.slice(index + 1),
  };
}

function loadAgentsPrompt(repoRoot: string): string {
  const agentsPath = path.join(repoRoot, "AGENTS.md");
  try {
    return readFileSync(agentsPath, "utf8").trim();
  } catch {
    return "";
  }
}

function buildPrompt(text: string, uploadedFiles: UploadedFile[], personaStyle: string, replyLanguage: string, telegramMessageTime?: string): string {
  const userRequest = text.trim() || "Handle the attached Telegram input according to AGENTS.md and the repository note workflow.";
  const common = [
    "Work inside the repository context and strictly follow AGENTS.md.",
    "If the request touches memory, notes, prior uploads, named entities, assets, or long-term storage, you must follow the repository note workflow in AGENTS.md instead of answering from general impression.",
    "Before creating a new note, search for the best existing related note and update or merge into it when the subject already exists.",
    "If you claim something was saved, updated, moved, linked, or persisted, make the corresponding repository changes first in this run. Do not merely describe intended actions.",
    telegramMessageTime ? `Telegram message time: ${telegramMessageTime}` : "",
    `If you can return normal text, prefer ${replyLanguage} in a concise helpful style.`,
    "If you need the Telegram bot to send repository files back, reply with JSON only: {\"message\": string, \"files\": string[] }.",
    `When returning that JSON, \`message\` is the normal ${replyLanguage} reply shown to the user.`,
    "When returning that JSON, `files` is a list of repository-relative file paths to send back to Telegram. If no file should be sent, use an empty array.",
    "If you return non-text multimodal output parts such as audio, images, or video directly, that is also allowed.",
    "Answer the user directly. Do not expose internal note paths, markdown filenames, memory file names, or repository organization details unless the user explicitly asks for them.",
    personaStyle ? `Style for Telegram replies: ${personaStyle}` : "",
    "When you know a real repository file path, prefer explicit repo-relative paths such as assets/... or tmp/... .",
  ].filter(Boolean);

  if (uploadedFiles.length === 0) {
    return [
      "User request:",
      userRequest,
      "",
      ...common,
    ].join("\n");
  }

  const fileBlock = uploadedFiles
    .map((file) => `- ${file.savedPath} (${file.mimeType}, ${Math.ceil(file.sizeBytes / 1024)} KB, source=${file.source})`)
    .join("\n");
  return [
    "The user uploaded files through Telegram. The files have already been saved under tmp/ in this repository.",
    "These files are the most recent uploads in the current conversation. Unless the user clearly switches to another target, treat them as the files being referred to now.",
    "If the user wants them organized, archived, remembered, or linked, persist the actual files under assets/ with sensible English names and subdirectories, then link those real asset paths from the relevant note.",
    "Do not leave long-term files only in tmp/, and do not create markdown placeholder files under assets/ as a substitute for the real uploaded file.",
    "Saved files:",
    fileBlock,
    "",
    "User request:",
    userRequest,
    "",
    ...common,
  ].join("\n");
}

function extractText(message: { parts?: Array<{ type?: string; text?: string }>; info?: { structured_output?: unknown } }): string {
  const parts = message.parts || [];
  const texts = parts
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim())
    .filter(Boolean);
  if (texts.length > 0) return texts.join("\n\n");
  if (parts.some((part) => part.type === "file")) return "Generated attachment output.";
  return "Completed with no displayable text output.";
}

function summarizeParts(message: { parts?: Array<{ type?: string; text?: string; mime?: string; filename?: string; url?: string }> }): Array<Record<string, unknown>> {
  return (message.parts || []).map((part) => ({
    type: part.type || "unknown",
    textLength: typeof part.text === "string" ? part.text.length : 0,
    mime: part.mime,
    filename: part.filename,
    hasUrl: typeof part.url === "string",
  }));
}

function extractPromptResult(message: { parts?: Array<{ type?: string; text?: string; mime?: string; filename?: string; url?: string }>; info?: { structured_output?: unknown } }): PromptResult {
  const plain = extractText(message).trim();
  const attachments = (message.parts || [])
    .filter((part) => part.type === "file" && typeof part.url === "string" && typeof part.mime === "string")
    .map((part) => ({
      mimeType: part.mime as string,
      filename: typeof part.filename === "string" ? part.filename : undefined,
      url: part.url as string,
    }));

  for (const candidate of extractJsonCandidates(plain)) {
    try {
      const parsed = JSON.parse(candidate) as { message?: unknown; files?: unknown };
      if (typeof parsed.message === "string") {
        return {
          message: parsed.message.trim() || "Done.",
          files: Array.isArray(parsed.files)
            ? parsed.files.filter((item): item is string => typeof item === "string")
            : [],
          attachments,
        };
      }
    } catch {
      // try next candidate
    }
  }

  return { message: plain || "Done.", files: [], attachments };
}

function extractJsonCandidates(text: string): string[] {
  const candidates: string[] = [];
  const trimmed = text.trim();
  if (trimmed) candidates.push(trimmed);

  const fenceMatches = Array.from(trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g))
    .map((match) => (match[1] || "").trim())
    .filter(Boolean);
  candidates.push(...fenceMatches);

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1).trim());
  }

  return Array.from(new Set(candidates));
}
