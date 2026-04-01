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
    "Reply with plain text unless files, reminders, or relaying to another known Telegram user are needed.",
    "For structured output, return exactly one JSON object with no Markdown fences or extra commentary.",
    "Structured output schema: {\"message\": string, \"files\": string[], \"reminders\": [], \"outboundMessages\": []}. Keep all top-level fields present; use \"\" or [] when empty.",
    "Reminder item schema: {\"title\": string, \"schedule\": {...}, optional \"note\", \"kind\", \"category\", \"specialKind\", \"timeSemantics\", \"timezone\", \"notifications\", optional \"targetUser\", optional \"targetUsers\" }.",
    "Reminder schedule kind must be exactly one of: once, interval, weekly, monthly, yearly, lunarYearly.",
    "Schedule rules: once -> {\"kind\":\"once\",\"at\":\"ISO-8601\"}; interval -> {\"kind\":\"interval\",\"every\":number,\"unit\":\"minute|hour|day|week|month|year\", optional \"anchor\":\"ISO-8601\"}; weekly -> {\"kind\":\"weekly\",\"every\":number,\"daysOfWeek\":number[],\"time\":\"HH:MM\"}; monthly -> {\"kind\":\"monthly\",\"every\":number,\"mode\":\"dayOfMonth\"|\"nthWeekday\",\"time\":\"HH:MM\"} plus dayOfMonth or weekOfMonth+dayOfWeek; yearly -> {\"kind\":\"yearly\",\"every\":number,\"month\":number,\"day\":number,\"time\":\"HH:MM\"}; lunarYearly -> {\"kind\":\"lunarYearly\",\"month\":number,\"day\":number,\"time\":\"HH:MM\"} with optional isLeapMonth and leapMonthPolicy.",
    "If notifications are included, each item must use integer \"offsetMinutes\"; omit notifications entirely when defaults are fine.",
    "Outbound message schema: {\"message\": string, optional \"targetUser\", optional \"targetUsers\" }. A target item uses { optional \"id\", \"username\", \"displayName\", \"role\" }. Use targetUsers when more than one recipient is intended.",
    "If the user asks you to tell, inform, relay, forward, or share information with another Telegram user now, use outboundMessages instead of reminders. Use reminders only when the user explicitly wants a future reminder.",
    "Prefer familiar short names or nicknames for people when known. In multi-user Telegram relays, prefer the recipient's nickname or familiar short name when natural.",
    personaStyle ? `Telegram reply style: ${personaStyle}` : "",
  ].filter(Boolean);

  const access = accessRole === "admin"
    ? [
        "Requester role: admin.",
        "Repository memory and files may be updated when needed; config changes require explicit admin request.",
      ]
    : accessRole === "trusted"
      ? [
          "Requester role: trusted.",
          "Repository memory, reminders, and files may be updated when needed; do not modify config.toml or runtime configuration.",
        ]
      : [
          "Requester role: allowed.",
          "Treat repository memory and files as read-only, do not reveal private repository data, and do not modify config.toml or runtime configuration.",
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
