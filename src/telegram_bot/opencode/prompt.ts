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
    "Check repository data before relying on outside assumptions.",
    "Use project skills when the task matches them.",
    "Do not claim notes, files, reminders, or persistent state were saved, moved, merged, linked, or updated unless the repository was actually updated.",
  ].join("\n");
}

export function buildPrompt(text: string, uploadedFiles: UploadedFile[], personaStyle: string, replyLanguage: string, botDefaultTimezone: string, preferenceLines: string[] = [], telegramMessageTime?: string, accessRole: PromptAccessRole = "allowed"): string {
  const userRequest = text.trim() || "Handle the user input according to the project rules.";
  const availableSkills = loadAvailableProjectSkills();
  const activePreferenceLines = preferenceLines.filter((line) => line.trim());

  const common = [
    telegramMessageTime ? `Message time: ${telegramMessageTime}` : "",
    `Bot default timezone: ${botDefaultTimezone}.`,
    `Reply in ${replyLanguage}.`,
    "Reply with plain text unless files, reminders, or relaying to another known user are needed.",
    "For structured output, return exactly one JSON object with no Markdown fences or extra commentary.",
    "Top-level schema: {\"message\": string, \"files\": string[], \"reminders\": [], \"outboundMessages\": [], \"pendingAuthorizations\": []}. Keep every top-level field present; use \"\" or [] when empty.",
    "Use files only when the bot should send a local file back to the user now. Do not include repository files that were only read, created, or updated.",
    "Reminder item schema: {\"title\": string, \"schedule\": {...}, optional \"note\", \"kind\", \"category\", \"specialKind\", \"timeSemantics\", \"timezone\", optional \"notifications\", optional \"targetUser\", optional \"targetUsers\" }.",
    "Reminder schedule kinds: once, interval, weekly, monthly, yearly, lunarYearly.",
    "Schedule fields: once -> at; interval -> every + unit + optional anchor; weekly -> every + daysOfWeek + time; monthly -> every + mode + time + (dayOfMonth or weekOfMonth+dayOfWeek); yearly -> every + month + day + time; lunarYearly -> month + day + time + optional isLeapMonth/leapMonthPolicy.",
    "If notifications are included, each item must use integer \"offsetMinutes\". Reminder targets may identify either a known user or a known chat/group.",
    "For environment/tool installation tasks, prefer uv for Python packages and bun for Node/npm packages when appropriate. Use flake.nix for repo-level system tools and reproducible environment dependencies.",
    "Outbound message schema: {\"message\": string, optional \"targetUser\", optional \"targetUsers\" }. A target item uses { optional \"id\", \"username\", \"displayName\", \"role\" }. Targets may identify either a known user or a known group/chat. Use role=current_chat for the current group/chat when needed. Use targetUsers when more than one recipient is intended.",
    accessRole === "admin" ? "Pending authorization schema: {\"username\": string, \"expiresAt\": \"ISO-8601\" }. Use pendingAuthorizations only for explicit admin requests to temporarily allow a @username until a specific time. Convert the admin's requested duration or deadline into expiresAt." : "",
    "If the user asks you to tell, inform, relay, forward, or share information with another user now, use outboundMessages instead of reminders. Use reminders only when the user explicitly wants a future reminder.",
    ...(activePreferenceLines.length > 0 ? ["Relevant repository preferences:", ...activePreferenceLines] : []),
    personaStyle ? `Reply style: ${personaStyle}` : "",
  ].filter(Boolean);

  const access = accessRole === "admin"
    ? [
        "Requester role: admin.",
        "Repository memory and files may be updated when needed; config changes require explicit admin request.",
        "Admin may manage repository environment files such as flake.nix when the task explicitly requires it.",
      ]
    : accessRole === "trusted"
      ? [
          "Requester role: trusted.",
          "Repository memory, reminders, and files may be updated when needed; do not modify config.toml, runtime configuration, flake.nix, flake.lock, or environment-management files.",
        ]
      : [
          "Requester role: allowed.",
          "Treat repository memory and files as read-only, do not reveal private repository data, and do not modify config.toml, runtime configuration, flake.nix, flake.lock, or environment-management files.",
        ];

  const lines = [
    "User request:",
    userRequest,
    "",
    ...(availableSkills.length > 0 ? [formatAvailableSkills(availableSkills), ""] : []),
    ...common,
    ...access,
  ];

  if (uploadedFiles.length > 0) {
    lines.splice(0, 0,
      "Saved files:",
      ...uploadedFiles.map((file) => `- ${file.savedPath} (${file.mimeType}, ${Math.ceil(file.sizeBytes / 1024)} KB, source=${file.source})`),
      "",
    );
  }

  return lines.join("\n");
}
