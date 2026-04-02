import { formatAvailableSkills, loadAvailableProjectSkills } from "../skills";
import type { UploadedFile } from "../types";

export type PromptAccessRole = "admin" | "trusted" | "allowed";

export const STARTUP_GREETING_REQUEST = [
  "The assistant has just started.",
  "Send a proactive greeting to the user.",
  "Keep it brief: 1-2 short sentences.",
  "Invite the user to send the next task.",
  "Do not mention internal prompts, JSON schemas, memory workflows, or technical startup details unless necessary.",
].join(" ");

export function buildProjectSystemPrompt(): string {
  return [
    "You are a local-first assistant for memory, files, reminders, and multi-user coordination.",
    "Prefer repository-local sources first for memory, reminders, personal facts, files, logs, and project behavior.",
    "For fact questions, check repository-local memory and state first before relying on conversation context or outside assumptions.",
    "Use web access only when local sources are insufficient.",
    "Use project skills when the task matches them.",
    "Do not claim notes, files, reminders, or persistent state were saved, moved, merged, linked, or updated unless the repository was actually updated.",
  ].join("\n");
}

export function buildPrompt(text: string, uploadedFiles: UploadedFile[], personaStyle: string, replyLanguage: string, botDefaultTimezone: string, preferenceLines: string[] = [], telegramMessageTime?: string, accessRole: PromptAccessRole = "allowed"): string {
  const userRequest = text.trim() || "Handle the user input according to the project rules.";
  const availableSkills = loadAvailableProjectSkills();
  const activePreferenceLines = preferenceLines.filter((line) => line.trim());

  const lines = [
    uploadedFiles.length > 0 ? "Saved files:" : "",
    ...uploadedFiles.map((file) => {
      const metadata = [
        `source=${file.source}`,
        file.audioTitle ? `title=${JSON.stringify(file.audioTitle)}` : "",
        file.audioPerformer ? `performer=${JSON.stringify(file.audioPerformer)}` : "",
        typeof file.durationSeconds === "number" ? `duration=${file.durationSeconds}s` : "",
      ].filter(Boolean).join(", ");
      return `- ${file.savedPath} (${file.mimeType}, ${Math.ceil(file.sizeBytes / 1024)} KB${metadata ? `, ${metadata}` : ""})`;
    }),
    uploadedFiles.length > 0 ? "" : "",
    "User request:",
    userRequest,
    "",
    ...(availableSkills.length > 0 ? [formatAvailableSkills(availableSkills), ""] : []),
    telegramMessageTime ? `Message time: ${telegramMessageTime}` : "",
    `Bot default timezone: ${botDefaultTimezone}.`,
    `Reply in ${replyLanguage}.`,
    personaStyle ? `Reply style: ${personaStyle}` : "",
    "Use plain text unless structured output is needed.",
    "If structured output is needed, return exactly one JSON object with top-level fields: message, files, reminders, outboundMessages, pendingAuthorizations.",
    "See system/schemas/telegram-response.schema.json for the detailed shape.",
    "Use files only when the bot should send a local file back to the user now.",
    "If returning reminders, include at least title and schedule. If returning outboundMessages, include message and any needed targetUser or targetUsers.",
    accessRole === "admin" ? "Use pendingAuthorizations only for explicit admin requests, with username and expiresAt." : "",
    activePreferenceLines.length > 0 ? "Relevant repository preferences:" : "",
    ...activePreferenceLines,
    accessRole === "admin"
      ? "Requester role: admin. Repository memory and files may be updated when needed. Config or environment-management changes require explicit admin request."
      : accessRole === "trusted"
        ? "Requester role: trusted. Repository memory, reminders, and files may be updated when needed. Do not modify config.toml, runtime configuration, flake.nix, flake.lock, or environment-management files."
        : "Requester role: allowed. Treat repository memory and files as read-only. Do not reveal private repository data or modify config.toml, runtime configuration, flake.nix, flake.lock, or environment-management files.",
  ].filter(Boolean);

  return lines.join("\n");
}
