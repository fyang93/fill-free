import type { Context } from "grammy";
import type { AppConfig } from "./types";
import { findTelegramUsers, getTelegramUserDisplayName, listKnownTelegramUsers, rememberTelegramUser } from "./state";

export type ReminderTargetResolution = {
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

export function buildReminderPromptContext(config: AppConfig, ctx: Context): string {
  const authorizedUserIds = authorizedTelegramUserIds(config);
  const lines: string[] = [];
  const requester = ctx.from;
  if (requester?.id) {
    lines.push(`Requester: ${telegramUserSummary({ id: requester.id, username: requester.username, displayName: [requester.first_name, requester.last_name].filter(Boolean).join(" ").trim() || requester.username || String(requester.id) })}`);
  }

  const repliedMessage = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  if (repliedMessage?.from?.id && authorizedUserIds.includes(repliedMessage.from.id)) {
    lines.push(`Reply target: ${telegramUserSummary({ id: repliedMessage.from.id, username: repliedMessage.from.username, displayName: [repliedMessage.from.first_name, repliedMessage.from.last_name].filter(Boolean).join(" ").trim() || repliedMessage.from.username || String(repliedMessage.from.id) })}`);
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

export function resolveReminderTargetUser(config: AppConfig, rawTarget: unknown, ctx: Context, requesterUserId?: number): ReminderTargetResolution {
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
  const targetLabel = username ? `@${username}` : displayName || role || (typeof directId === "number" ? String(directId) : "对方");

  if (role && ["admin", "administrator", "管理员"].includes(role) && config.telegram.adminUserId) {
    const adminUserId = config.telegram.adminUserId;
    return {
      status: "resolved",
      userId: adminUserId,
      displayName: getTelegramUserDisplayName(adminUserId, authorizedUserIds) || displayName || "管理员",
    };
  }

  const repliedMessage = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  const repliedDisplayName = repliedMessage?.from && authorizedUserIds.includes(repliedMessage.from.id)
    ? getTelegramUserDisplayName(repliedMessage.from.id, authorizedUserIds)
      || [repliedMessage.from.first_name, repliedMessage.from.last_name].filter(Boolean).join(" ").trim()
      || repliedMessage.from.username
      || String(repliedMessage.from.id)
    : undefined;
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
    const options = matchedUsers.slice(0, 5).map((user) => user.username ? `${user.displayName} (@${user.username})` : `${user.displayName}（id: ${user.id}）`).join("、");
    return {
      status: "ambiguous",
      question: repliedDisplayName
        ? `你想提醒的是谁？我找到多个可能对象：${options}。你是指当前回复的这位 ${repliedDisplayName} 吗？如果是，请直接说“提醒他/她……”，或者直接 @对方后再说一次。`
        : `你想提醒的是谁？我找到多个可能对象：${options}。请直接 @对方，或回复对方消息后再说一次。`,
    };
  }

  if (directId) {
    return {
      status: "not_found",
      question: repliedDisplayName
        ? `我还不能确认 Telegram 用户 ${targetLabel} 是谁。你是指当前回复的这位 ${repliedDisplayName} 吗？如果是，请直接说“提醒他/她……”，或者直接 @对方后再说一次。`
        : `我还不能确认 Telegram 用户 ${targetLabel} 是谁。请直接 @对方，或回复对方消息后再说一次。`,
    };
  }

  return {
    status: "not_found",
    question: repliedDisplayName
      ? `我还不能确认“${targetLabel}”是谁。你是指当前回复的这位 ${repliedDisplayName} 吗？如果是，请直接说“提醒他/她……”，或者直接 @对方后再说一次。`
      : `我还不能确认“${targetLabel}”是谁。请直接 @对方，或回复对方消息后再说一次。`,
  };
}
