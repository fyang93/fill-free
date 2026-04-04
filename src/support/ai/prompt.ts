import type { UploadedFile } from "scheduling/app/types";

export type RequestAccessRole = "admin" | "trusted" | "allowed";

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
  ].join("\n");
}

export function buildPrompt(text: string, uploadedFiles: UploadedFile[], replyLanguage: string, defaultTimezone: string, personaStyle: string, messageTime?: string, accessRole: RequestAccessRole = "allowed", responderContextText?: string, requesterTimezone?: string | null): string {
  const userRequest = text.trim() || "Handle the user input according to the project rules.";

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
    responderContextText ? responderContextText : "",
    responderContextText ? "" : "",
    messageTime ? `Message time: ${messageTime}` : "",
    requesterTimezone?.trim() ? `Requester timezone: ${requesterTimezone.trim()}.` : `Default timezone: ${defaultTimezone}.`,
    `Reply in ${replyLanguage}.`,
    personaStyle ? `Reply style: ${personaStyle}` : "",
    "Write the direct user-facing reply now.",
    "Use the provided responder context as the immediate factual context for this reply.",
    "If it is insufficient for a factual or repository-grounded answer, give a brief user-facing reply and return a task with domain=query and operation=answer-from-repo.",
    "For that query task, include payload.requestText with the original user request.",
    "Use plain text unless structured output is needed.",
    "If structured output is needed, return exactly one JSON object with top-level fields: message, files, reminders, outboundMessages, pendingAuthorizations, tasks.",
    "When returning structured output, message must already be the user-facing reply text.",
    "Use files only when the bot should send a local file now.",
    "For reminders include at least title and schedule. For outboundMessages include message and target.",
    "Use tasks for deferred or durable follow-up work.",
    "Do not claim durable changes unless you also return the corresponding structured action.",
    accessRole === "admin" ? "Requester role: admin. Repository updates are allowed when appropriate. Use pendingAuthorizations for temporary access grants. Use access/set-role tasks for durable role changes." : "",
    accessRole === "trusted"
      ? "Requester role: trusted. Normal memory, reminder, and file-related updates are allowed, but configuration or environment changes are not."
      : accessRole === "allowed"
        ? "Requester role: allowed. Treat repository memory and files as read-only, and do not reveal private repository data."
        : "",
  ].filter(Boolean);

  return lines.join("\n");
}
