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

export function buildPrompt(text: string, uploadedFiles: UploadedFile[], personaStyle: string, replyLanguage: string, botDefaultTimezone: string, telegramMessageTime?: string, accessRole: PromptAccessRole = "allowed"): string {
  const userRequest = text.trim() || "Handle the user input according to the project rules.";
  const availableSkills = loadAvailableProjectSkills();

  const common = [
    "Project policies:",
    "- Prefer repository-local sources first.",
    "- Check memory/, assets/, system/, and relevant logs/code before external search when applicable.",
    "- Treat system/ as code-managed persistent data, not general memory notes.",
    telegramMessageTime ? `Message time: ${telegramMessageTime}` : "",
    `Bot default timezone: ${botDefaultTimezone}.`,
    `Reply in ${replyLanguage}.`,
    "Reply with plain text unless files, reminders, or relaying to another known user are needed.",
    "For structured output, return exactly one JSON object with no Markdown fences or extra commentary.",
    "Structured output schema: {\"message\": string, \"files\": string[], \"reminders\": [], \"outboundMessages\": [], \"pendingAuthorizations\": []}. Keep all top-level fields present; use \"\" or [] when empty.",
    "Reminder item schema: {\"title\": string, \"schedule\": {...}, optional \"note\", \"kind\", \"category\", \"specialKind\", \"timeSemantics\", \"timezone\", \"notifications\", optional \"targetUser\", optional \"targetUsers\" }. Reminder targets may identify either a known user or a known chat/group.",
    "Reminder schedule kind must be exactly one of: once, interval, weekly, monthly, yearly, lunarYearly.",
    "Schedule rules: once -> {\"kind\":\"once\",\"at\":\"ISO-8601\"}; interval -> {\"kind\":\"interval\",\"every\":number,\"unit\":\"minute|hour|day|week|month|year\", optional \"anchor\":\"ISO-8601\"}; weekly -> {\"kind\":\"weekly\",\"every\":number,\"daysOfWeek\":number[],\"time\":\"HH:MM\"}; monthly -> {\"kind\":\"monthly\",\"every\":number,\"mode\":\"dayOfMonth\"|\"nthWeekday\",\"time\":\"HH:MM\"} plus dayOfMonth or weekOfMonth+dayOfWeek; yearly -> {\"kind\":\"yearly\",\"every\":number,\"month\":number,\"day\":number,\"time\":\"HH:MM\"}; lunarYearly -> {\"kind\":\"lunarYearly\",\"month\":number,\"day\":number,\"time\":\"HH:MM\"} with optional isLeapMonth and leapMonthPolicy.",
    "If notifications are included, each item must use integer \"offsetMinutes\"; omit notifications entirely when defaults are fine.",
    "For reminders, let code own defaults. Unless the user explicitly specifies otherwise, do not invent custom reminder offsets when defaults already apply.",
    "Whenever you mention a specific time, date-time, deadline, schedule, or reminder time in the user-facing message, include the timezone explicitly unless the message is purely relative and timezone-free.",
    "In group chats or multi-user contexts, be extra careful not to present bare clock times without a timezone.",
    "For birthday, anniversary, festival, and memorial reminders, omit notifications unless the user explicitly overrides them so code can apply the default sequence.",
    "For environment/tool installation tasks, prefer uv for Python packages and bun for Node/npm packages when appropriate. Use flake.nix for repo-level system tools and reproducible environment dependencies.",
    "Outbound message schema: {\"message\": string, optional \"targetUser\", optional \"targetUsers\" }. A target item uses { optional \"id\", \"username\", \"displayName\", \"role\" }. Targets may identify either a known user or a known group/chat. Use role=current_chat for the current group/chat when needed. Use targetUsers when more than one recipient is intended.",
    accessRole === "admin" ? "Pending authorization schema: {\"username\": string, \"expiresAt\": \"ISO-8601\" }. Use pendingAuthorizations only for explicit admin requests to temporarily allow a @username until a specific time. Convert the admin's requested duration or deadline into expiresAt." : "",
    "If the user asks you to tell, inform, relay, forward, or share information with another user now, use outboundMessages instead of reminders. Use reminders only when the user explicitly wants a future reminder.",
    "Prefer familiar short names or nicknames for people when known. In multi-user Telegram relays, prefer the recipient's nickname or familiar short name when natural.",
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
