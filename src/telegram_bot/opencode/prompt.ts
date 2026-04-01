import { readFileSync } from "node:fs";
import path from "node:path";
import type { UploadedFile } from "../types";

export const STARTUP_GREETING_REQUEST = [
  "The Telegram bot has just started.",
  "There are no pending user messages waiting to be handled right now.",
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

export function buildPrompt(text: string, uploadedFiles: UploadedFile[], personaStyle: string, replyLanguage: string, telegramMessageTime?: string, isTrustedUser = false): string {
  const userRequest = text.trim() || "Handle the attached Telegram input according to AGENTS.md and the repository note workflow.";

  const common: string[] = [
    "Follow AGENTS.md.",
    telegramMessageTime ? `Telegram message time: ${telegramMessageTime}` : "",
    `Reply in ${replyLanguage}.`,
    "If you need the bot to send repository files back or create reminders, reply with JSON only: {\"message\": string, \"files\": string[], \"reminders\": [] }.",
    "Keep the JSON minimal.",
    "For reminders, include only fields you are confident about. Timezone is mainly for fixed appointments, not routine local-time habits.",
    "Non-text output is also allowed.",
  ];

  if (isTrustedUser) {
    common.push(
      "Trusted user: you may read and modify repository memory/files when needed.",
      "Use AGENTS.md for memory or file changes.",
      personaStyle ? `Style for Telegram replies: ${personaStyle}` : "",
    );
  } else {
    common.push(
      "Allowed user: treat the repository as read-only unless the request is clearly informational.",
      "Do not modify files or long-term memory.",
      personaStyle ? `Style for Telegram replies: ${personaStyle}` : "",
    );
  }

  const effectiveCommon = common.filter(Boolean);

  if (uploadedFiles.length === 0) {
    return [
      "User request:",
      userRequest,
      "",
      ...effectiveCommon,
    ].join("\n");
  }

  const fileBlock = uploadedFiles
    .map((file) => `- ${file.savedPath} (${file.mimeType}, ${Math.ceil(file.sizeBytes / 1024)} KB, source=${file.source})`)
    .join("\n");
  return [
    "The user uploaded files through Telegram.",
    "Saved files:",
    fileBlock,
    "",
    "User request:",
    userRequest,
    "",
    ...effectiveCommon,
  ].join("\n");
}
