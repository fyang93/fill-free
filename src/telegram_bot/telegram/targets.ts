import type { Context } from "grammy";
import type { AppConfig } from "../app/types";
import { findTelegramChats, findTelegramUsers, getTelegramUserDisplayName, rememberTelegramChat, rememberTelegramUser } from "./registry";
import { state } from "../app/state";

export type TelegramTargetIssue =
  | { kind: "ambiguous"; targetLabel: string; options: string[]; replyTarget?: string }
  | { kind: "not_found"; targetLabel: string; replyTarget?: string };

export type TelegramTargetResolution = {
  status: "self" | "resolved" | "ambiguous" | "not_found";
  userId?: number;
  chatId?: number;
  targetKind?: "user" | "chat";
  displayName?: string;
  issue?: TelegramTargetIssue;
};

function scoreFriendlyName(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return Number.POSITIVE_INFINITY;
  let score = trimmed.length;
  if (trimmed.startsWith("@")) score += 6;
  if (/\s/.test(trimmed)) score += 4;
  if (/^[A-Za-z0-9 _.-]+$/.test(trimmed)) score += 2;
  return score;
}

function preferredFriendlyName(candidates: Array<string | undefined>): string | undefined {
  return candidates
    .map((item) => item?.trim())
    .filter((item): item is string => Boolean(item))
    .sort((a, b) => scoreFriendlyName(a) - scoreFriendlyName(b) || a.length - b.length)[0];
}

function telegramUserSummary(user: { id: number; username?: string; displayName: string }): string {
  return user.username
    ? `${user.displayName} (@${user.username})`
    : user.displayName;
}

export function authorizedTelegramUserIds(config: AppConfig): number[] {
  const ids = new Set<number>();
  if (config.telegram.adminUserId) ids.add(config.telegram.adminUserId);
  config.telegram.trustedUserIds.forEach((id) => ids.add(id));
  config.telegram.allowedUserIds.forEach((id) => ids.add(id));
  return Array.from(ids);
}

export function preferredTelegramName(config: AppConfig, userId: number | undefined, fallback?: { username?: string; first_name?: string; last_name?: string }): string | undefined {
  if (!userId) return undefined;
  const known = state.telegramUsers[String(userId)];
  return preferredFriendlyName([
    known?.firstName,
    fallback?.first_name,
    known?.displayName,
    getTelegramUserDisplayName(userId, authorizedTelegramUserIds(config)) || undefined,
    fallback?.username ? `@${fallback.username}` : undefined,
  ]);
}

function telegramDisplayName(config: AppConfig, user: { id: number; username?: string; first_name?: string; last_name?: string }, authorizedUserIds: number[]): string {
  return preferredTelegramName(config, user.id, user)
    || getTelegramUserDisplayName(user.id, authorizedUserIds)
    || [user.first_name, user.last_name].filter(Boolean).join(" ").trim()
    || user.username
    || String(user.id);
}

function buildTelegramContextLines(config: AppConfig, ctx: Context): string[] {
  const authorizedUserIds = authorizedTelegramUserIds(config);
  const lines: string[] = [];
  const requester = ctx.from;
  if (requester?.id) {
    lines.push(`Requester: ${telegramUserSummary({ id: requester.id, username: requester.username, displayName: getTelegramUserDisplayName(requester.id, authorizedUserIds) || telegramDisplayName(config, requester, authorizedUserIds) })}`);
  }

  const repliedMessage = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  if (repliedMessage?.from?.id && authorizedUserIds.includes(repliedMessage.from.id)) {
    lines.push(`Reply target: ${telegramUserSummary({ id: repliedMessage.from.id, username: repliedMessage.from.username, displayName: getTelegramUserDisplayName(repliedMessage.from.id, authorizedUserIds) || telegramDisplayName(config, repliedMessage.from, authorizedUserIds) })}`);
  }

  return lines;
}

function replyTargetDisplayName(config: AppConfig, ctx: Context, authorizedUserIds: number[]): string | undefined {
  const repliedMessage = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  if (!repliedMessage?.from?.id || !authorizedUserIds.includes(repliedMessage.from.id)) return undefined;
  return preferredTelegramName(config, repliedMessage.from.id, repliedMessage.from)
    || telegramDisplayName(config, repliedMessage.from, authorizedUserIds);
}

function targetIssueFact(issue: TelegramTargetIssue): string {
  if (issue.kind === "ambiguous") {
    return issue.replyTarget
      ? `Outbound target is ambiguous. Matches: ${issue.options.join(", ") || "unknown"}. Replied message target: ${issue.replyTarget}. Ask the user to confirm by @mention or by replying again.`
      : `Outbound target is ambiguous. Matches: ${issue.options.join(", ") || "unknown"}. Ask the user to confirm by @mention or by replying again.`;
  }
  return issue.replyTarget
    ? `Outbound target could not be identified: ${issue.targetLabel}. Replied message target: ${issue.replyTarget}. Ask the user to confirm by @mention or by replying again.`
    : `Outbound target could not be identified: ${issue.targetLabel}. Ask the user to confirm by @mention or by replying again.`;
}

export function describeTelegramTargetIssue(issue: TelegramTargetIssue): string {
  return targetIssueFact(issue);
}

export function rememberTelegramParticipants(config: AppConfig, ctx: Context): boolean {
  const authorizedUserIds = authorizedTelegramUserIds(config);
  let changed = rememberTelegramUser(ctx.from, authorizedUserIds);
  changed = rememberTelegramChat(ctx.chat) || changed;
  const repliedMessage = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  if (repliedMessage?.from) changed = rememberTelegramUser(repliedMessage.from, authorizedUserIds) || changed;
  return changed;
}

export function buildTelegramPromptContext(config: AppConfig, ctx: Context): string {
  const lines = buildTelegramContextLines(config, ctx);
  return lines.length > 0 ? ["Telegram context:", ...lines].join("\n") : "";
}

export function resolveTelegramTargetUser(config: AppConfig, rawTarget: unknown, ctx: Context, requesterUserId?: number): TelegramTargetResolution {
  const authorizedUserIds = authorizedTelegramUserIds(config);
  if (!rawTarget || typeof rawTarget !== "object") {
    return requesterUserId
      ? { status: "self", userId: requesterUserId, displayName: preferredTelegramName(config, requesterUserId) || getTelegramUserDisplayName(requesterUserId, authorizedUserIds) || undefined }
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
      displayName: preferredTelegramName(config, adminUserId) || getTelegramUserDisplayName(adminUserId, authorizedUserIds) || displayName || "admin",
    };
  }

  const repliedMessage = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  const repliedDisplayName = replyTargetDisplayName(config, ctx, authorizedUserIds);
  const isGroupChat = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
  if (role && ["current_chat", "this_chat", "当前聊天"].includes(role) && ctx.chat?.id) {
    const chatTitle = "title" in ctx.chat && typeof ctx.chat.title === "string" && ctx.chat.title.trim() ? ctx.chat.title.trim() : ctx.chat.username ? `@${ctx.chat.username}` : String(ctx.chat.id);
    return {
      status: "resolved",
      chatId: ctx.chat.id,
      targetKind: "chat",
      displayName: chatTitle,
    };
  }
  if (role && ["group", "chat", "当前群聊"].includes(role) && isGroupChat && ctx.chat?.id) {
    const chatTitle = "title" in ctx.chat && typeof ctx.chat.title === "string" && ctx.chat.title.trim() ? ctx.chat.title.trim() : ctx.chat.username ? `@${ctx.chat.username}` : String(ctx.chat.id);
    return {
      status: "resolved",
      chatId: ctx.chat.id,
      targetKind: "chat",
      displayName: chatTitle,
    };
  }
  if (role && ["reply", "reply_target", "replied_user", "被回复的人"].includes(role) && repliedMessage?.from?.id && authorizedUserIds.includes(repliedMessage.from.id)) {
    return {
      status: "resolved",
      userId: repliedMessage.from.id,
      targetKind: "user",
      displayName: repliedDisplayName || displayName,
    };
  }

  const matchedChats = findTelegramChats({ id: directId, username, displayName }).filter((chat) => chat.type !== "private");
  if (matchedChats.length === 1) {
    const matchedChat = matchedChats[0];
    return {
      status: "resolved",
      chatId: matchedChat.id,
      targetKind: "chat",
      displayName: matchedChat.title || (matchedChat.username ? `@${matchedChat.username}` : String(matchedChat.id)),
    };
  }

  if (matchedChats.length > 1) {
    return {
      status: "ambiguous",
      issue: {
        kind: "ambiguous",
        targetLabel,
        options: matchedChats.slice(0, 5).map((chat) => chat.username ? `${chat.title || chat.type} (@${chat.username})` : `${chat.title || chat.type} (id: ${chat.id})`),
        replyTarget: repliedDisplayName,
      },
    };
  }

  const matchedUsers = findTelegramUsers({ id: directId, username, displayName }, authorizedUserIds);
  if (matchedUsers.length === 1) {
    const matchedUser = matchedUsers[0];
    return {
      status: "resolved",
      userId: matchedUser.id,
      targetKind: "user",
      displayName: preferredFriendlyName([preferredTelegramName(config, matchedUser.id), matchedUser.firstName, matchedUser.displayName]) || (matchedUser.username ? `${matchedUser.displayName} (@${matchedUser.username})` : matchedUser.displayName),
    };
  }

  if (matchedUsers.length > 1) {
    return {
      status: "ambiguous",
      issue: {
        kind: "ambiguous",
        targetLabel,
        options: matchedUsers.slice(0, 5).map((user) => user.username ? `${user.displayName} (@${user.username})` : `${user.displayName} (id: ${user.id})`),
        replyTarget: repliedDisplayName,
      },
    };
  }

  return {
    status: "not_found",
    issue: { kind: "not_found", targetLabel, replyTarget: repliedDisplayName },
  };
}

export function resolveTelegramTargetUsers(config: AppConfig, rawTargets: unknown, ctx: Context, requesterUserId?: number): { resolved: TelegramTargetResolution[]; clarifications: string[] } {
  const inputs = Array.isArray(rawTargets) ? rawTargets : rawTargets == null ? [] : [rawTargets];
  const resolved: TelegramTargetResolution[] = [];
  const clarifications: string[] = [];
  const seen = new Set<string>();

  for (const input of inputs) {
    const target = resolveTelegramTargetUser(config, input, ctx, requesterUserId);
    if (target.issue) {
      const clarification = describeTelegramTargetIssue(target.issue);
      if (!clarifications.includes(clarification)) clarifications.push(clarification);
      continue;
    }
    const key = target.status === "self" ? "self" : target.chatId != null ? `chat:${target.chatId}` : target.userId != null ? `user:${target.userId}` : `${target.status}:${target.displayName || "?"}`;
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(target);
  }

  return { resolved, clarifications };
}

export type ReminderTargetResolution = TelegramTargetResolution;

export function resolveReminderTargetUser(config: AppConfig, rawTarget: unknown, ctx: Context, requesterUserId?: number): ReminderTargetResolution {
  return resolveTelegramTargetUser(config, rawTarget, ctx, requesterUserId);
}
