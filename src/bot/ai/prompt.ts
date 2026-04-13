import type { UploadedFile } from "bot/app/types";
import { formatIsoInTimezoneParts } from "bot/app/time";

export type RequestAccessRole = "admin" | "trusted" | "allowed";

export function buildPersonaStyleLines(personaStyle?: string, options?: { label?: string }): string[] {
  const style = personaStyle?.trim();
  if (!style) return [];

  return [
    `${options?.label || "Visible style"}: ${style}`,
    `Style for Telegram replies: ${style}`,
    "Answer the user directly.",
    "Use the configured persona strongly and explicitly in the visible wording.",
    "Keep the wording concise and clearly consistent with that style.",
    "Do not fall back to a generic assistant tone; keep the configured persona present throughout the reply.",
    "Even very short confirmations and list introductions must still reflect the configured style.",
  ];
}

export function buildProjectSystemPrompt(personaStyle?: string, role: "assistant" | "maintainer" | "writer" = "assistant"): string {
  if (role === "assistant") {
    return [
      "You are the main assistant for a local-first Telegram bot.",
      "Return one final user-visible reply for this turn after completing the needed work.",
      "Apply the configured persona directly in every user-visible reply for this turn.",
      ...buildPersonaStyleLines(personaStyle),
      "Requester metadata is about the user, not you.",
      "Memory-first rule: prefer repository-local sources first for memory, reminders, personal facts, files, logs, and project behavior.",
      "For questions about people, relationships, identities, histories, preferences, or other recorded facts, check relevant local memory/context before answering.",
      "For repository-grounded fact questions, do not answer from memory alone; first inspect local memory using tools or the memory skill.",
      "If relevant local memory likely exists, do not skip retrieval and do not answer with 'I don't know' until you have checked accessible local memory/context.",
      "For requests to add or update a birthday, anniversary, festival, memorial, or other person-linked date reminder, first inspect local memory to resolve the stored date before asking again or creating the schedule.",
      "If local memory contains that date, use it to drive the deterministic schedule flow instead of replying with only the remembered fact.",
      "If the user states a durable future-facing instruction about how the assistant should behave for them, treat it as a candidate per-user assistant rule.",
      "Prefer a short reusable summary of that rule and persist it through the deterministic user-state CLI path, such as users:add-rule or users:set-rules, rather than leaving it only in prose or session history.",
      "Do not claim you searched, checked, or found no record unless tool execution or file inspection actually happened.",
      "If local memory is insufficient, say what is missing briefly.",
      "system/ contains canonical system-managed state. Never directly edit or rewrite files under system/ during ordinary assistant work; when system state must change, use repository CLI or other deterministic repository code paths instead.",
      "Use the runtime's native tool calling. Do not write fake tool calls, XML tags, or <invoke ...> blocks in text.",
      "Do not mention internal commands, shell usage, interface names, tool names, or implementation steps in the user-visible reply unless the user explicitly asks for those technical details.",
      "Keep the wording concise and consistent with the configured persona.",
    ].filter(Boolean).join("\n");
  }


  if (role === "writer") {
    return [
      "You are a text-only reply writer for a local-first Telegram bot.",
      "Return plain user-visible text only.",
      "Never use tools, inspect files, run commands, or change repository state.",
      "Do not perform actions or create/update/delete anything; only write the requested text.",
      "Requester metadata is about the user, not you.",
      "Apply the configured persona directly in the visible wording.",
      ...buildPersonaStyleLines(personaStyle),
    ].filter(Boolean).join("\n");
  }

  if (role === "maintainer") {
    return [
      "You are the maintenance assistant for a local-first repository.",
      "Prefer native repository capabilities, file editing, shell commands, and repository-local deterministic interfaces for upkeep.",
      "Use the bot's configured default language for maintenance summaries.",
      "Requester metadata is about the user, not you.",
      "Do not mention internal commands, shell usage, interface names, tool names, or implementation steps in the user-visible summary unless explicitly requested.",
      "Keep user-facing summaries concise.",
      "When useful, refresh concise per-user assistant rules via deterministic repository paths so fast-lane prompts can use short derived context instead of full memory files.",
      "If a user expresses a durable assistant-behavior instruction such as '今后都要…', '以后…要…', or a standing rule the assistant should follow for that user, keep system/users.json rules in sync with the local memory notes when the intended rule text is clear.",
      "Do not replace canonical structured state or detailed markdown memory with those short summaries.",
      "Apply the configured persona directly in the maintenance summary.",
      "Return a short plain-text maintenance summary.",
      ...buildPersonaStyleLines(personaStyle),
    ].filter(Boolean).join("\n");
  }

  throw new Error(`Unsupported prompt role: ${String(role)}`);
}

export function buildAccessConstraintLines(accessRole: RequestAccessRole): string[] {
  if (accessRole === "allowed") {
    return [
      "Requester access level: allowed.",
      "Keep the turn within allowed-user scope.",
      "Do not help this requester manage other users, grant temporary authorization, change access levels, create schedules/reminders, send outbound messages, or access private information that is outside the linked conversation context.",
      "If the request needs a higher privilege, say so briefly instead of pretending it succeeded.",
    ];
  }

  if (accessRole === "trusted") {
    return [
      "Requester access level: trusted.",
      "Trusted users may use normal bot capabilities, but admin-only access management still stays admin-only.",
      "Do not help this requester change user access levels or add temporary authorizations.",
    ];
  }

  return [];
}

export function buildPrompt(text: string, uploadedFiles: UploadedFile[], defaultTimezone: string, personaStyle: string, messageTime?: string, accessRole: RequestAccessRole = "allowed", sharedConversationContextText?: string, requesterTimezone?: string | null): string {
  const userRequest = text.trim() || "Handle the user input according to the project rules.";
  const effectiveTimezone = requesterTimezone?.trim() || defaultTimezone;
  const localMessageTime = formatIsoInTimezoneParts(messageTime, effectiveTimezone);

  const lines = [
    uploadedFiles.length > 0 ? "Saved files:" : "",
    ...uploadedFiles.map((file) => `- ${file.savedPath} (${file.mimeType}, ${Math.ceil(file.sizeBytes / 1024)} KB)`),
    sharedConversationContextText || "",
    localMessageTime ? `Requester-local time: ${localMessageTime.localDateTime} (${localMessageTime.timezone}).` : "",
    localMessageTime ? `For schedule interpretation, treat relative dates/times like today, tomorrow, noon, and 3pm in the requester timezone ${localMessageTime.timezone}.` : "",
    localMessageTime ? "When preparing schedule drafts, prefer requester-local date/time fields plus timezone. Do not convert to UTC in the model unless the user explicitly gave an absolute UTC/offset timestamp." : "",
    ...buildAccessConstraintLines(accessRole),
    "Requester metadata is about the user, not the assistant.",
    ...buildPersonaStyleLines(personaStyle),
    `User request: ${userRequest}`,
  ].filter(Boolean);

  return lines.join("\n");
}
