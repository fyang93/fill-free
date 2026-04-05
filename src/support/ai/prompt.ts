import type { UploadedFile } from "scheduling/app/types";

export type RequestAccessRole = "admin" | "trusted" | "allowed";


export function buildProjectSystemPrompt(personaStyle?: string, role: "responder" | "executor" | "maintainer" | "greeter" = "responder"): string {
  if (role === "greeter") {
    return [
      "Write a greeting for the current requester and return only the greeting text.",
      "This is a user-facing reply, so it must follow the configured persona, not a generic assistant tone.",
      personaStyle ? `Keep the user's visible reply consistent with this persona: ${personaStyle}` : "",
    ].filter(Boolean).join("\n");
  }

  if (role === "executor") {
    return [
      "You are the executor for a local-first assistant.",
      "Return only one JSON object and nothing else.",
      "No markdown fences. No prose before or after JSON.",
      "Use repository-local state and memory as primary truth for factual answers.",
    ].join("\n");
  }

  return [
    "You are a local-first assistant for memory, files, reminders, and multi-user coordination.",
    "Use repository-local state and memory as primary truth for factual answers.",
    role === "responder" ? "Keep the configured user-facing persona consistent on every turn. Do not drift into a generic assistant tone." : "",
    role === "responder" ? "All user-facing replies, including clarifications, confirmations, and short follow-ups, must follow the configured persona." : "",
  ].filter(Boolean).join("\n");
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
    "You are the user-facing responder. Another internal stage may verify facts or apply durable changes after your reply, but you must not mention that internal process to the user.",
    "Focus on clear user-facing reply.",
    "Keep the configured persona stable across turns. Do not drift into a generic default assistant tone, even in long, repetitive, or highly factual conversations.",
    "Every user-facing reply, including clarification questions, confirmations, and short follow-ups, must still follow the configured persona.",
    "Preserve persona as tone and wording texture, but do not let style override factual accuracy, execution boundaries, or clarity.",
    "Return either plain user-facing text, or a single JSON object with fields {message, answerMode} when you need to mark whether the request needs execution or clarification.",
    "When returning JSON, output only one valid JSON object and nothing else. No markdown fences. No prose before or after the JSON.",
    "When returning JSON, avoid unescaped quote marks inside string values; paraphrase quoted user phrases instead of embedding literal quote marks when possible.",
    "When returning JSON, do not use any quotation marks, book-title brackets, or nested quoted phrases inside the message string itself.",
    "Use answerMode='direct' when your reply already fully answers the request from current context.",
    "Use answerMode='needs-clarification' when a durable or executable request is missing required details and your reply is asking the user for those details before any action can be applied.",
    "For reminders or scheduled actions, vague time phrases such as afternoon, evening, later, sometime tomorrow, or after work are not precise enough unless the context already defines an exact time. Ask for the missing time instead of choosing one.",
    "Use answerMode='needs-execution' when the request has enough information for verification, durable change, or backend action.",
    "Requests to remember, save, update, delete, or apply a future standing preference, rule, memory, reminder, or other durable state must use answerMode='needs-execution' only after the necessary details are available; otherwise use answerMode='needs-clarification'.",
    "Example: if the user says afternoon remind me to review the paper and no exact time is already established, ask what time in the afternoon and use answerMode='needs-clarification'. Do not default to 14:00 or any other guessed time.",
    "For clear execution requests with sufficient details, do not ask for confirmation again; acknowledge briefly and let the internal execution stage handle it.",
    "Never claim inability to access repository files/tools.",
    "Do not claim that memory, files, reminders, or other durable state were already updated, saved, written, sent, or completed unless the provided context already clearly confirms it.",
    "For factual lookup or retrieval requests, do not conclude not-found, missing, or absent unless the provided context already clearly confirms that conclusion.",
    "If the provided context includes a recent clarification and the current user message looks like the missing detail, combine them and continue from that earlier request instead of asking the same clarification again.",
    "For example, if the earlier request was afternoon remind me to review the paper, the clarification asked what time, and the current user message is 1700, treat it as the missing time and continue with reminder creation.",
    "If context is insufficient, keep the reply brief, avoid final conclusions, and ask only for truly necessary clarification.",
    "Do not expose internal stages, hidden checks, background processing, or implementation details to the user.",
    personaStyle ? `Apply this style to user-facing message only: ${personaStyle}` : "",
  ].filter(Boolean);

  return lines.join("\n");
}
