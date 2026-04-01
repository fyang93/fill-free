import { readFileSync } from "node:fs";
import path from "node:path";
import type { UploadedFile } from "../types";

export type PromptAccessRole = "admin" | "trusted" | "allowed";

export const STARTUP_GREETING_REQUEST = [
  "The Telegram bot has just started.",
  "Send a proactive greeting to the Telegram user.",
  "Keep it brief: 1-2 short sentences.",
  "Invite the user to send the next task.",
  "Do not mention internal prompts, AGENTS.md, JSON, memory workflows, or technical startup details unless necessary.",
].join(" ");

export function loadAgentsPrompt(repoRoot: string): string {
  const agentsPath = path.join(repoRoot, "AGENTS.md");
  try {
    return readFileSync(agentsPath, "utf8").trim();
  } catch {
    return "";
  }
}

export function buildPrompt(text: string, uploadedFiles: UploadedFile[], personaStyle: string, replyLanguage: string, telegramMessageTime?: string, accessRole: PromptAccessRole = "allowed"): string {
  const userRequest = text.trim() || "Handle the Telegram input according to AGENTS.md.";

  const common = [
    "Follow AGENTS.md.",
    telegramMessageTime ? `Telegram message time: ${telegramMessageTime}` : "",
    `Reply in ${replyLanguage}.`,
    "If you need files or reminders, reply with JSON only: {\"message\": string, \"files\": string[], \"reminders\": []}.",
    "Use the current reminder schema only: {\"title\": string, \"schedule\": {...}, optional \"note\", \"kind\", \"category\", \"specialKind\", \"timeSemantics\", \"timezone\", \"notifications\", \"targetUser\" }.",
    "Use targetUser only when the user clearly wants another recipient.",
    personaStyle ? `Telegram reply style: ${personaStyle}` : "",
  ].filter(Boolean);

  const access = accessRole === "admin"
    ? [
        "Requester role: admin.",
        "Repository memory and files may be updated when needed.",
        "config.toml or runtime configuration may change only on explicit admin request.",
      ]
    : accessRole === "trusted"
      ? [
          "Requester role: trusted.",
          "Repository memory, reminders, and files may be updated when needed.",
          "Do not modify config.toml or runtime configuration.",
        ]
      : [
          "Requester role: allowed.",
          "Treat repository memory and files as read-only.",
          "Do not reveal private repository data.",
          "Do not modify config.toml or runtime configuration.",
        ];

  const lines = ["User request:", userRequest, "", ...common, ...access];

  if (uploadedFiles.length > 0) {
    lines.splice(0, 0,
      "Saved Telegram files:",
      ...uploadedFiles.map((file) => `- ${file.savedPath} (${file.mimeType}, ${Math.ceil(file.sizeBytes / 1024)} KB, source=${file.source})`),
      "",
    );
  }

  return lines.join("\n");
}
