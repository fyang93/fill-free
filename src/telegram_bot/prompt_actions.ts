import type { Bot, Context } from "grammy";
import { logger } from "./logger";
import type { OpenCodeService } from "./opencode";
import type { PromptAccessRole } from "./opencode/prompt";
import type { PromptOutboundMessageDraft, PromptResult } from "./opencode/types";
import { createStructuredReminders } from "./reminder_intent";
import { storePendingAuthorizations } from "./pending_access";
import { sendMessageFormatted } from "./telegram_format";
import { resolveTelegramTargetUsers } from "./telegram_identity";
import type { AppConfig } from "./types";
import { t } from "./i18n";

const OUTBOUND_TARGET_REQUIRED_FACT = "Outbound target is missing. Ask the user to specify the recipient by @mention or by replying to that person's message.";
const OUTBOUND_TRUST_REQUIRED_FACT = "Outbound relay is not allowed for this requester. Only trusted or admin users may ask the bot to message other Telegram users.";

export type PromptActionExecution = {
  facts: string[];
  replyAppendix: string;
};

type ExecutePromptActionsInput = {
  config: AppConfig;
  bot: Bot<Context>;
  opencode: OpenCodeService;
  answer: PromptResult;
  ctx: Context;
  requesterUserId?: number;
  telegramMessageTime?: string;
  canDeliverOutbound: boolean;
  accessRole: PromptAccessRole;
};

type OutboundDeliveryResult = {
  delivered: string[];
  clarifications: string[];
  sentMessages: Array<{ recipientLabel: string; text: string }>;
};

function summarizeFactBlock(plural: string, items: string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0] || "";
  return `${plural}:\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function quoteBlock(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `> ${line || " "}`)
    .join("\n");
}

function buildOutboundReplyAppendix(config: AppConfig, sentMessages: Array<{ recipientLabel: string; text: string }>): string {
  if (sentMessages.length === 0) return "";
  return sentMessages
    .map(({ recipientLabel, text }) => `${t(config, "outbound_sent_quote_header", { recipient: recipientLabel })}\n${quoteBlock(text)}`)
    .join("\n\n");
}

async function deliverOutboundMessages(
  config: AppConfig,
  bot: Bot<Context>,
  ctx: Context,
  outboundMessages: PromptOutboundMessageDraft[],
  requesterUserId: number | undefined,
  accessRole: PromptAccessRole,
  opencode: OpenCodeService,
): Promise<OutboundDeliveryResult> {
  const delivered: string[] = [];
  const clarifications: string[] = [];
  const sentMessages: Array<{ recipientLabel: string; text: string }> = [];

  for (const outbound of outboundMessages) {
    const text = typeof outbound.message === "string" ? outbound.message.trim() : "";
    if (!text) continue;

    const rawTargets = Array.isArray(outbound.targetUsers) && outbound.targetUsers.length > 0
      ? outbound.targetUsers
      : outbound.targetUser
        ? [outbound.targetUser]
        : [];
    if (rawTargets.length === 0) {
      clarifications.push(OUTBOUND_TARGET_REQUIRED_FACT);
      continue;
    }

    const targetResult = resolveTelegramTargetUsers(config, rawTargets, ctx, requesterUserId);
    clarifications.push(...targetResult.clarifications);

    for (const target of targetResult.resolved) {
      const recipientId = target.status === "self" ? requesterUserId : target.chatId ?? target.userId;
      if (!recipientId) {
        clarifications.push(OUTBOUND_TARGET_REQUIRED_FACT);
        continue;
      }
      const recipientLabel = target.displayName || String(recipientId);
      try {
        const relayText = await opencode.composeOutboundRelayMessage(text, recipientLabel);
        await sendMessageFormatted(bot, recipientId, relayText);
        delivered.push(`Outbound message delivered. Recipient: ${recipientLabel}.`);
        sentMessages.push({ recipientLabel, text: relayText });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await logger.warn(`failed to send outbound message to target=${recipientId}: ${message}`);
        clarifications.push(`Outbound delivery failed. Recipient: ${recipientLabel}. Error: ${message}`);
      }
    }
  }

  return { delivered, clarifications, sentMessages };
}

export async function executePromptActions(input: ExecutePromptActionsInput): Promise<PromptActionExecution> {
  const reminderResult = await createStructuredReminders(
    input.config,
    input.opencode,
    input.answer.reminders,
    input.ctx,
    input.requesterUserId,
    input.telegramMessageTime,
  );

  const outboundResult = input.canDeliverOutbound
    ? await deliverOutboundMessages(input.config, input.bot, input.ctx, input.answer.outboundMessages, input.requesterUserId, input.accessRole, input.opencode)
    : input.answer.outboundMessages.length > 0
      ? { delivered: [], clarifications: [OUTBOUND_TRUST_REQUIRED_FACT], sentMessages: [] }
      : { delivered: [], clarifications: [], sentMessages: [] };
  const pendingAuthorizationResult = await storePendingAuthorizations(
    input.config,
    input.answer.pendingAuthorizations,
    input.requesterUserId,
    input.accessRole,
  );

  return {
    facts: [
      summarizeFactBlock("Multiple reminders created", reminderResult.created),
      summarizeFactBlock("Multiple outbound messages delivered", outboundResult.delivered),
      summarizeFactBlock("Multiple temporary authorizations prepared", pendingAuthorizationResult.created),
      ...reminderResult.clarifications,
      ...outboundResult.clarifications,
      ...pendingAuthorizationResult.clarifications,
    ].filter(Boolean),
    replyAppendix: buildOutboundReplyAppendix(input.config, outboundResult.sentMessages),
  };
}
