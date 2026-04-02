import type { Context } from "grammy";

type AnyRecord = Record<string, unknown>;

export type TelegramReplyContext = {
  kind: "reply_to_message" | "external_reply" | "quote";
  messageKeys: string;
  messageId?: string;
  senderUserId?: string;
  senderLabel?: string;
  originType?: string;
  text?: string;
  entityTypes?: string;
  captionEntityTypes?: string;
  externalReplyKeys?: string;
  quoteKeys?: string;
  hasText: boolean;
};

function asRecord(value: unknown): AnyRecord | undefined {
  return value && typeof value === "object" ? value as AnyRecord : undefined;
}

function summarize(text: string, maxLength = 500): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed.length > maxLength ? `${trimmed.slice(0, maxLength)}…` : trimmed;
}

function entityTypes(value: unknown): string {
  return Array.isArray(value)
    ? value.map((entity) => asRecord(entity)?.type).filter((type): type is string => typeof type === "string").join(",")
    : "";
}

function senderLabelFromUser(user: AnyRecord | undefined): string | undefined {
  if (typeof user?.username === "string" && user.username.trim()) return `@${user.username}`;
  if (typeof user?.first_name === "string" && user.first_name.trim()) return user.first_name;
  return undefined;
}

function senderLabelFromOrigin(origin: AnyRecord | undefined): string | undefined {
  const senderUser = asRecord(origin?.sender_user);
  if (senderUser) return senderLabelFromUser(senderUser);
  const senderChat = asRecord(origin?.sender_chat);
  if (typeof senderChat?.username === "string" && senderChat.username.trim()) return `@${senderChat.username}`;
  if (typeof senderChat?.title === "string" && senderChat.title.trim()) return senderChat.title;
  if (typeof origin?.sender_user_name === "string" && origin.sender_user_name.trim()) return origin.sender_user_name;
  const channelChat = asRecord(origin?.chat);
  if (typeof channelChat?.username === "string" && channelChat.username.trim()) return `@${channelChat.username}`;
  if (typeof channelChat?.title === "string" && channelChat.title.trim()) return channelChat.title;
  return undefined;
}

function textFromMessageLike(value: AnyRecord | undefined): string | undefined {
  if (typeof value?.text === "string") return value.text;
  if (typeof value?.caption === "string") return value.caption;
  return undefined;
}

export function summarizeIncomingText(text: string, maxLength = 500): string {
  return summarize(text, maxLength);
}

export function extractTelegramReplyContext(ctx: Context): TelegramReplyContext | null {
  const message = asRecord(ctx.message);
  const messageKeys = message ? Object.keys(message).sort().join(",") : "";
  const repliedMessage = asRecord(message?.reply_to_message);
  if (repliedMessage) {
    const text = textFromMessageLike(repliedMessage)?.trim();
    const sender = asRecord(repliedMessage.from);
    return {
      kind: "reply_to_message",
      messageKeys,
      messageId: String(repliedMessage.message_id ?? "unknown"),
      senderUserId: String(sender?.id ?? "unknown"),
      senderLabel: senderLabelFromUser(sender) || "unknown",
      text,
      entityTypes: entityTypes(repliedMessage.entities),
      captionEntityTypes: entityTypes(repliedMessage.caption_entities),
      hasText: Boolean(text),
    };
  }

  const externalReply = asRecord(message?.external_reply);
  const quote = asRecord(message?.quote);
  const quoteText = typeof quote?.text === "string" ? quote.text.trim() : "";
  if (externalReply) {
    const text = textFromMessageLike(externalReply)?.trim() || quoteText || undefined;
    const origin = asRecord(externalReply.origin);
    return {
      kind: "external_reply",
      messageKeys,
      messageId: typeof externalReply.message_id === "number" ? String(externalReply.message_id) : undefined,
      senderLabel: senderLabelFromOrigin(origin),
      originType: typeof origin?.type === "string" ? origin.type : undefined,
      text,
      externalReplyKeys: Object.keys(externalReply).sort().join(","),
      quoteKeys: quote ? Object.keys(quote).sort().join(",") : "",
      hasText: Boolean(text),
    };
  }

  if (quoteText) {
    return {
      kind: "quote",
      messageKeys,
      text: quoteText,
      quoteKeys: quote ? Object.keys(quote).sort().join(",") : "",
      hasText: true,
    };
  }

  return null;
}

export function telegramReplySummary(ctx: Context): string {
  const message = asRecord(ctx.message);
  const messageKeys = message ? Object.keys(message).sort().join(",") : "";
  const reply = extractTelegramReplyContext(ctx);
  if (!reply) {
    const externalReply = asRecord(message?.external_reply);
    const quote = asRecord(message?.quote);
    const quoteText = typeof quote?.text === "string" ? summarize(quote.text) : "";
    return ` messageKeys=${JSON.stringify(messageKeys)} hasReplyField=${message && "reply_to_message" in message ? "yes" : "no"} hasExternalReply=${externalReply ? "yes" : "no"} externalReplyKeys=${JSON.stringify(externalReply ? Object.keys(externalReply).sort().join(",") : "")} hasQuote=${quote ? "yes" : "no"} quoteKeys=${JSON.stringify(quote ? Object.keys(quote).sort().join(",") : "")} quoteText=${JSON.stringify(quoteText)} replyToMessage=none`;
  }

  if (reply.kind === "reply_to_message") {
    return ` messageKeys=${JSON.stringify(reply.messageKeys)} hasReplyField=yes hasExternalReply=${message && message.external_reply ? "yes" : "no"} hasQuote=${message && message.quote ? "yes" : "no"} replyToMessage=${reply.messageId ?? "unknown"} replyToKind=${reply.hasText ? "text" : "other"} replyToUser=${reply.senderUserId ?? "unknown"} replyToHasText=${reply.hasText ? "yes" : "no"} replyToText=${JSON.stringify(summarize(reply.text || ""))} replyToEntities=${JSON.stringify(reply.entityTypes || "")} replyToCaptionEntities=${JSON.stringify(reply.captionEntityTypes || "")}`;
  }

  return ` messageKeys=${JSON.stringify(reply.messageKeys)} hasReplyField=no hasExternalReply=${message && message.external_reply ? "yes" : "no"} externalReplyKeys=${JSON.stringify(reply.externalReplyKeys || "")} hasQuote=${message && message.quote ? "yes" : "no"} quoteKeys=${JSON.stringify(reply.quoteKeys || "")} replyToKind=${reply.kind} replyToMessage=${JSON.stringify(reply.messageId || "none")} replyOriginType=${JSON.stringify(reply.originType || "")} replyToSender=${JSON.stringify(reply.senderLabel || "")} replyToHasText=${reply.hasText ? "yes" : "no"} replyToText=${JSON.stringify(summarize(reply.text || ""))}`;
}

export function buildTelegramReplyContextPrompt(ctx: Context): string {
  const reply = extractTelegramReplyContext(ctx);
  if (!reply) return "";

  if (reply.kind === "reply_to_message") {
    if (!reply.text) {
      return [
        "Reply context:",
        `The user is replying to a message from ${reply.senderLabel || "unknown"}. Telegram provided a reply target, but no text or caption content was available in the replied message payload.`,
      ].join("\n");
    }
    return [
      "Reply context:",
      `The user is replying to a message from ${reply.senderLabel || "unknown"}. Treat the replied message as part of the current request when relevant.`,
      "Replied message content:",
      reply.text,
    ].join("\n");
  }

  const lines = ["Reply context:"];
  if (reply.kind === "external_reply") {
    lines.push("Telegram provided external reply metadata for the replied message.");
  } else {
    lines.push("Telegram provided quoted reply context for the replied message.");
  }
  if (reply.senderLabel) lines.push(`Reply source: ${reply.senderLabel}`);
  if (reply.originType) lines.push(`Reply origin type: ${reply.originType}`);
  if (reply.text) {
    lines.push(reply.kind === "quote" ? "Quoted reply content:" : "Reply content available from Telegram:");
    lines.push(reply.text);
  }
  return lines.join("\n");
}
