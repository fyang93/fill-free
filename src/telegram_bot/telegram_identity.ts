import type { Context } from "grammy";
import { t } from "./i18n";
import type { AppConfig } from "./types";
import { findTelegramUsers, getTelegramUserDisplayName, listKnownTelegramUsers, rememberTelegramUser } from "./state";
import { describeTelegramIdentityBinding } from "./telegram_bindings";

export type TelegramTargetResolution = {
  status: "self" | "resolved" | "ambiguous" | "not_found";
  userId?: number;
  displayName?: string;
  question?: string;
};

function telegramUserSummary(user: { id: number; username?: string; displayName: string }): string {
  return user.username
    ? `id=${user.id}, username=@${user.username}, displayName=${user.displayName}`
    : `id=${user.id}, displayName=${user.displayName}`;
}

export function authorizedTelegramUserIds(config: AppConfig): number[] {
  const ids = new Set<number>();
  if (config.telegram.adminUserId) ids.add(config.telegram.adminUserId);
  config.telegram.trustedUserIds.forEach((id) => ids.add(id));
  config.telegram.allowedUserIds.forEach((id) => ids.add(id));
  return Array.from(ids);
}

export function rememberTelegramParticipants(config: AppConfig, ctx: Context): boolean {
  const authorizedUserIds = authorizedTelegramUserIds(config);
  let changed = rememberTelegramUser(ctx.from, authorizedUserIds);
  const repliedMessage = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  if (repliedMessage?.from) changed = rememberTelegramUser(repliedMessage.from, authorizedUserIds) || changed;
  return changed;
}

export function buildTelegramPromptContext(config: AppConfig, ctx: Context): string {
  const authorizedUserIds = authorizedTelegramUserIds(config);
  const lines: string[] = [];
  const requester = ctx.from;
  if (requester?.id) {
    lines.push(`Requester: ${telegramUserSummary({ id: requester.id, username: requester.username, displayName: [requester.first_name, requester.last_name].filter(Boolean).join(" ").trim() || requester.username || String(requester.id) })}`);
    const requesterBinding = describeTelegramIdentityBinding(config, requester.id);
    if (requesterBinding) lines.push(`Requester identity: ${requesterBinding}`);
  }

  const repliedMessage = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  if (repliedMessage?.from?.id && authorizedUserIds.includes(repliedMessage.from.id)) {
    lines.push(`Reply target: ${telegramUserSummary({ id: repliedMessage.from.id, username: repliedMessage.from.username, displayName: [repliedMessage.from.first_name, repliedMessage.from.last_name].filter(Boolean).join(" ").trim() || repliedMessage.from.username || String(repliedMessage.from.id) })}`);
    const replyBinding = describeTelegramIdentityBinding(config, repliedMessage.from.id);
    if (replyBinding) lines.push(`Reply target identity: ${replyBinding}`);
  }

  const adminUserId = config.telegram.adminUserId;
  if (adminUserId) {
    lines.push(`Admin user id: ${adminUserId}`);
  }

  const knownUsers = listKnownTelegramUsers(authorizedUserIds).slice(0, 12);
  if (knownUsers.length > 0) {
    lines.push("Known Telegram users:");
    lines.push(...knownUsers.map((user) => `- ${telegramUserSummary(user)}`));
  }

  if (lines.length === 0) return "";
  return ["Telegram context:", ...lines].join("\n");
}

function replyTargetDisplayName(ctx: Context, authorizedUserIds: number[]): string | undefined {
  const repliedMessage = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  if (!repliedMessage?.from?.id || !authorizedUserIds.includes(repliedMessage.from.id)) return undefined;
  return getTelegramUserDisplayName(repliedMessage.from.id, authorizedUserIds)
    || [repliedMessage.from.first_name, repliedMessage.from.last_name].filter(Boolean).join(" ").trim()
    || repliedMessage.from.username
    || String(repliedMessage.from.id);
}

function targetQuestion(config: AppConfig, key: "telegram_target_ambiguous" | "telegram_target_ambiguous_with_reply" | "telegram_target_not_found" | "telegram_target_not_found_with_reply", values: Record<string, string>): string {
  return t(config, key, values);
}

export function resolveTelegramTargetUser(config: AppConfig, rawTarget: unknown, ctx: Context, requesterUserId?: number): TelegramTargetResolution {
  const authorizedUserIds = authorizedTelegramUserIds(config);
  if (!rawTarget || typeof rawTarget !== "object") {
    return requesterUserId
      ? { status: "self", userId: requesterUserId, displayName: getTelegramUserDisplayName(requesterUserId, authorizedUserIds) || undefined }
      : { status: "self" };
  }

  const record = rawTarget as Record<string, unknown>;
  const directId = typeof record.id === "number" && Number.isInteger(record.id) ? record.id : undefined;
  const username = typeof record.username === "string" && record.username.trim() ? record.username.trim().replace(/^@+/, "") : undefined;
  const displayName = typeof record.displayName === "string" && record.displayName.trim() ? record.displayName.trim() : undefined;
  const role = typeof record.role === "string" && record.role.trim() ? record.role.trim().toLowerCase() : undefined;
  const targetLabel = username ? `@${username}` : displayName || role || (typeof directId === "number" ? String(directId) : "?");

  if (role && ["admin", "administrator", "管理员"].includes(role) && config.telegram.adminUserId) {
    const adminUserId = config.telegram.adminUserId;
    return {
      status: "resolved",
      userId: adminUserId,
      displayName: getTelegramUserDisplayName(adminUserId, authorizedUserIds) || displayName || "admin",
    };
  }

  const repliedMessage = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  const repliedDisplayName = replyTargetDisplayName(ctx, authorizedUserIds);
  if (role && ["reply", "reply_target", "replied_user", "被回复的人"].includes(role) && repliedMessage?.from?.id && authorizedUserIds.includes(repliedMessage.from.id)) {
    return {
      status: "resolved",
      userId: repliedMessage.from.id,
      displayName: repliedDisplayName || displayName,
    };
  }

  const matchedUsers = findTelegramUsers({ id: directId, username, displayName }, authorizedUserIds);
  if (matchedUsers.length === 1) {
    const matchedUser = matchedUsers[0];
    return {
      status: "resolved",
      userId: matchedUser.id,
      displayName: matchedUser.username ? `${matchedUser.displayName} (@${matchedUser.username})` : matchedUser.displayName,
    };
  }

  if (matchedUsers.length > 1) {
    const options = matchedUsers.slice(0, 5).map((user) => user.username ? `${user.displayName} (@${user.username})` : `${user.displayName} (id: ${user.id})`).join(", ");
    return {
      status: "ambiguous",
      question: repliedDisplayName
        ? targetQuestion(config, "telegram_target_ambiguous_with_reply", { options, replyTarget: repliedDisplayName })
        : targetQuestion(config, "telegram_target_ambiguous", { options }),
    };
  }

  return {
    status: "not_found",
    question: repliedDisplayName
      ? targetQuestion(config, "telegram_target_not_found_with_reply", { targetLabel, replyTarget: repliedDisplayName })
      : targetQuestion(config, "telegram_target_not_found", { targetLabel }),
  };
}

export type ReminderTargetResolution = TelegramTargetResolution;

export function buildReminderPromptContext(config: AppConfig, ctx: Context): string {
  return buildTelegramPromptContext(config, ctx);
}

export function resolveReminderTargetUser(config: AppConfig, rawTarget: unknown, ctx: Context, requesterUserId?: number): ReminderTargetResolution {
  return resolveTelegramTargetUser(config, rawTarget, ctx, requesterUserId);
}
