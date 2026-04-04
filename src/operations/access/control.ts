import type { Context } from "grammy";
import type { AppConfig } from "scheduling/app/types";
import { grantPendingAllowedAccessIfMatched, pruneExpiredPendingAuthorizationsFromState } from "./authorizations";
import { logger } from "scheduling/app/logger";
import { touchActivity } from "scheduling/app/state";
import { accessLevelForUser, type AccessLevel } from "operations/access/roles";

type TelegramEntity = { type?: string; offset?: number; length?: number };

export function isAdminUserId(config: AppConfig, userId: number | undefined): boolean {
  return typeof userId === "number" && config.telegram.adminUserId === userId;
}

export function accessLevelForUserId(config: AppConfig, userId: number | undefined): AccessLevel {
  return accessLevelForUser(config, userId);
}

export function isTrustedUserId(config: AppConfig, userId: number | undefined): boolean {
  return accessLevelForUserId(config, userId) === "trusted";
}

export async function unauthorizedGuard(config: AppConfig, ctx: Context, next: () => Promise<void>): Promise<void> {
  const pruned = await pruneExpiredPendingAuthorizationsFromState(config);
  if (pruned > 0) {
    await logger.info(`pruned ${pruned} expired pending authorizations`);
  }

  const userId = ctx.from?.id;
  let accessLevel = accessLevelForUserId(config, userId);
  if (accessLevel === "none" && userId) {
    try {
      const granted = await grantPendingAllowedAccessIfMatched(config, ctx.from);
      if (granted.granted) {
        await logger.info(`granted allowed access from pending authorization user=${userId} username=@${granted.username} changed=${granted.changed}`);
        accessLevel = "allowed";
      }
    } catch (error) {
      await logger.warn(`failed to grant pending allowed access user=${userId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (accessLevel === "none") {
    await logger.warn(`access denied level=none user=${userId ?? "unknown"}`);
    return;
  }
  await logger.info(`access granted level=${accessLevel} user=${userId ?? "unknown"}`);
  touchActivity();
  await next();
}

export function requiresDirectMention(ctx: Context): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function entityMentionsBot(text: string | undefined, entities: TelegramEntity[] | undefined, botUsername: string | null): boolean {
  if (!text || !entities || !botUsername) return false;
  const expectedMention = `@${botUsername.toLowerCase()}`;
  return entities.some((entity) => {
    if (entity.type !== "mention") return false;
    if (typeof entity.offset !== "number" || typeof entity.length !== "number") return false;
    const mention = text.slice(entity.offset, entity.offset + entity.length).toLowerCase();
    return mention === expectedMention;
  });
}

function isReplyingToBot(message: Context["message"], botUserId: number | null): boolean {
  if (!message || botUserId == null) return false;
  const repliedMessage = "reply_to_message" in message ? message.reply_to_message : undefined;
  return repliedMessage?.from?.id === botUserId;
}

export function isAddressedToBot(ctx: Context, botUsername: string | null, botUserId: number | null): boolean {
  if (!requiresDirectMention(ctx)) return true;
  const message = ctx.message;
  if (!message) return false;

  if (isReplyingToBot(message, botUserId)) return true;

  const text = "text" in message ? message.text : undefined;
  const textEntities = "entities" in message ? (message.entities as TelegramEntity[] | undefined) : undefined;
  if (entityMentionsBot(text, textEntities, botUsername)) return true;

  const caption = "caption" in message ? message.caption : undefined;
  const captionEntities = "caption_entities" in message ? (message.caption_entities as TelegramEntity[] | undefined) : undefined;
  return entityMentionsBot(caption, captionEntities, botUsername);
}
