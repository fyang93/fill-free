import type { Context } from "grammy";
import type { AppConfig } from "bot/app/types";
import { buildStructuredContextLines, resolveUser } from "bot/operations/context/store";
import { listAuthorizedUserIds } from "bot/operations/access/roles";
import { findTelegramChats, findTelegramUsers, getTelegramUserDisplayName, rememberTelegramChat, rememberTelegramUser } from "./registry";
import { getUserTimezone, state } from "bot/app/state";

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
  return listAuthorizedUserIds(config);
}

export function preferredTelegramName(config: AppConfig, userId: number | undefined, fallback?: { username?: string; first_name?: string; last_name?: string }): string | undefined {
  if (!userId) return undefined;
  const known = resolveUser(config.paths.repoRoot, userId);
  const runtime = state.telegramUserCache[String(userId)];
  return preferredFriendlyName([
    known?.displayName,
    runtime?.displayName,
    fallback?.first_name,
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
    const requesterTimezone = getUserTimezone(requester.id);
    if (requesterTimezone) lines.push(`Requester timezone: ${requesterTimezone}`);
  }

  const repliedMessage = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  if (repliedMessage?.from?.id && authorizedUserIds.includes(repliedMessage.from.id)) {
    lines.push(`Reply target: ${telegramUserSummary({ id: repliedMessage.from.id, username: repliedMessage.from.username, displayName: getTelegramUserDisplayName(repliedMessage.from.id, authorizedUserIds) || telegramDisplayName(config, repliedMessage.from, authorizedUserIds) })}`);
    const replyTimezone = getUserTimezone(repliedMessage.from.id);
    if (replyTimezone) lines.push(`Reply target timezone: ${replyTimezone}`);
  }

  return lines.concat(buildStructuredContextLines(config.paths.repoRoot, {
    requesterUserId: requester?.id,
    requesterUsername: requester?.username,
    replyTargetUserId: repliedMessage?.from?.id && authorizedUserIds.includes(repliedMessage.from.id) ? repliedMessage.from.id : undefined,
    replyTargetUsername: repliedMessage?.from?.id && authorizedUserIds.includes(repliedMessage.from.id) ? repliedMessage.from.username : undefined,
    chatId: ctx.chat?.id,
  }));
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
  const repliedMessage = ctx.message && "reply_to_message" in ctx.message ? ctx.message.reply_to_message : undefined;
  let changed = rememberTelegramUser(ctx.from, authorizedUserIds);
  const participantUserIds = [ctx.from?.id, repliedMessage?.from?.id].filter((userId): userId is number => typeof userId === "number");
  changed = rememberTelegramChat(ctx.chat, participantUserIds) || changed;
  if (repliedMessage?.from) changed = rememberTelegramUser(repliedMessage.from, authorizedUserIds) || changed;
  return changed;
}

export function buildTelegramRequestContext(config: AppConfig, ctx: Context): string {
  const lines = buildTelegramContextLines(config, ctx);
  return lines.length > 0 ? ["Request context:", ...lines].join("\n") : "";
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
  const targetLabel = username ? `@${username}` : displayName || (typeof directId === "number" ? String(directId) : "?");

  const repliedDisplayName = replyTargetDisplayName(config, ctx, authorizedUserIds);

  const matchedChats = findTelegramChats({ id: directId, username, title: displayName, displayName }).filter((chat) => chat.type !== "private");
  if (matchedChats.length === 1) {
    const matchedChat = matchedChats[0];
    return {
      status: "resolved",
      chatId: matchedChat.id,
      targetKind: "chat",
      displayName: matchedChat.title || String(matchedChat.id),
    };
  }

  if (matchedChats.length > 1) {
    return {
      status: "ambiguous",
      issue: {
        kind: "ambiguous",
        targetLabel,
        options: matchedChats.slice(0, 5).map((chat) => `${chat.title || chat.type} (id: ${chat.id})`),
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
      displayName: preferredFriendlyName([preferredTelegramName(config, matchedUser.id), matchedUser.displayName]) || (matchedUser.username ? `${matchedUser.displayName} (@${matchedUser.username})` : matchedUser.displayName),
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

function targetResolutionKey(target: TelegramTargetResolution): string {
  if (target.status === "self") return "self";
  if (target.chatId != null) return `chat:${target.chatId}`;
  if (target.userId != null) return `user:${target.userId}`;
  return `${target.status}:${target.displayName || "?"}`;
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
    const key = targetResolutionKey(target);
    if (seen.has(key)) continue;
    seen.add(key);
    resolved.push(target);
  }

  return { resolved, clarifications };
}

export type EventTargetResolution = TelegramTargetResolution;

export function resolveEventTargetUser(config: AppConfig, rawTarget: unknown, ctx: Context, requesterUserId?: number): EventTargetResolution {
  return resolveTelegramTargetUser(config, rawTarget, ctx, requesterUserId);
}
