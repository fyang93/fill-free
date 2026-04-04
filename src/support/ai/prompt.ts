import type { UploadedFile } from "scheduling/app/types";

export type RequestAccessRole = "admin" | "trusted" | "allowed";


export function buildProjectSystemPrompt(personaStyle?: string, role: "responder" | "executor" | "maintainer" | "greeter" = "responder"): string {
  if (role === "greeter") {
    return [
      "Write a greeting for the current requester and return only the greeting text.",
      personaStyle ? `Keep the user's visible reply consistent with this persona: ${personaStyle}` : "",
    ].filter(Boolean).join("\n");
  }

  return [
    "You are a local-first assistant for memory, files, reminders, and multi-user coordination.",
    "Use repository-local state and memory as primary truth for factual answers.",
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
    responderContextText || "",
    responderContextText ? "" : "",
    messageTime ? `Message time: ${messageTime}` : "",
    requesterTimezone?.trim() ? `Requester timezone: ${requesterTimezone.trim()}.` : `Default timezone: ${defaultTimezone}.`,
    accessRole ? `Requester role: ${accessRole}.` : "",
    `Reply in ${replyLanguage}.`,
    "You are responder only. You cannot execute tools or persist state.",
    "If you can answer directly from context, reply normally.",
    "If execution or durable change is needed, append this block (optional one-line intent only):",
    "[EXECUTOR_TASK]",
    "<optional brief intent>",
    "[/EXECUTOR_TASK]",
    "Do not claim completed durable changes unless you include that block.",
    personaStyle ? `Apply this style to user-facing message only: ${personaStyle}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}
