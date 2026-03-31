import { readFileSync } from "node:fs";
import path from "node:path";
import { createOpencodeClient } from "@opencode-ai/sdk";
import type { AppConfig, UploadedFile } from "./types";
import { logger } from "./logger";

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
};
import { state, touchActivity } from "./state";

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

  async prompt(text: string, uploadedFiles: UploadedFile[] = []): Promise<PromptResult> {
    await this.ensureReady();
    if (!state.sessionId) {
      await this.newSession();
    }
    const sessionId = state.sessionId;
    if (!sessionId) throw new Error("Failed to initialize session");

    const body: {
      parts: Array<{ type: "text"; text: string }>;
      model?: { providerID: string; modelID: string };
      system: string;
    } = {
      system: this.agentsPrompt,
      parts: [{ type: "text", text: buildPrompt(text, uploadedFiles, this.config.telegram.personaStyle) }],
    };
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
    if (parsed.files.length === 0 && parsed.message === (rawText || "已处理。")) {
      await logger.warn("opencode prompt did not return valid JSON; using plain-text fallback");
    }
    await logger.info(`opencode prompt result message=${JSON.stringify(parsed.message)} files=${JSON.stringify(parsed.files)}`);
    return parsed;
  }

  async parseReminderRequest(text: string, referenceTimeIso: string): Promise<ReminderParseResult> {
    await this.ensureReady();
    const session = (await this.client.session.create({ body: { title: "Reminder parser" } })) as any;
    const sessionData = session.data ?? session;
    const reply = (await this.client.session.prompt({
      path: { id: sessionData.id },
      body: {
        system: "Decide whether the user is asking for a future reminder. Reply with JSON only.",
        parts: [{
          type: "text",
          text: [
            `Reference time: ${referenceTimeIso}`,
            "Return JSON with keys: shouldCreate(boolean), text(string), scheduledAt(ISO string), needsConfirmation(boolean), confirmationText(string).",
            "If this is not a reminder request, return {\"shouldCreate\":false}.",
            `User message: ${text}`,
          ].join("\n"),
        }],
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

function buildPrompt(text: string, uploadedFiles: UploadedFile[], personaStyle: string): string {
  const userRequest = text.trim() || "Handle the user's request according to AGENTS.md and the memory-agent workflow for this repository.";
  const common = [
    "Work inside the repository context and strictly follow AGENTS.md.",
    "Reply with JSON only: {\"message\": string, \"files\": string[] }.",
    "`message` is the normal Chinese reply shown to the user.",
    "`files` is a list of repository-relative file paths to send back to Telegram. If no file should be sent, use an empty array.",
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
    .map((file) => `- ${file.savedPath} (${file.mimeType}, ${Math.ceil(file.sizeBytes / 1024)} KB)`)
    .join("\n");
  return [
    "The user uploaded files through Telegram. The files have already been saved under tmp/ in this repository.",
    "These files are the most recent uploads in the current conversation. Unless the user clearly switches to another target, treat them as the files being referred to now.",
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
  const texts = (message.parts || [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim())
    .filter(Boolean);
  return texts.length > 0 ? texts.join("\n\n") : "已完成，但没有可显示的文本输出。";
}

function extractPromptResult(message: { parts?: Array<{ type?: string; text?: string }>; info?: { structured_output?: unknown } }): PromptResult {
  const plain = extractText(message).trim();
  for (const candidate of extractJsonCandidates(plain)) {
    try {
      const parsed = JSON.parse(candidate) as { message?: unknown; files?: unknown };
      if (typeof parsed.message === "string") {
        return {
          message: parsed.message.trim() || "已处理。",
          files: Array.isArray(parsed.files)
            ? parsed.files.filter((item): item is string => typeof item === "string")
            : [],
        };
      }
    } catch {
      // try next candidate
    }
  }

  return { message: plain || "已处理。", files: [] };
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
