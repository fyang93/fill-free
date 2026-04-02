import { state } from "../state";

export type TelegramUserInput = {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

export type TelegramChatInput = {
  id?: number;
  type?: string;
  title?: string;
  username?: string;
};

export type KnownTelegramUser = {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  displayName: string;
  lastSeenAt: string;
};

export type KnownTelegramChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  lastSeenAt: string;
};

function allowedUserIdSet(allowedUserIds?: number[]): Set<number> | null {
  return allowedUserIds && allowedUserIds.length > 0 ? new Set(allowedUserIds) : null;
}

function cleanOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function buildDisplayName(firstName?: string, lastName?: string, username?: string): string {
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  if (fullName) return fullName;
  if (username) return `@${username}`;
  return "Telegram user";
}

function normalizeLookupKey(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

export function rememberTelegramUser(user: TelegramUserInput | null | undefined, allowedUserIds?: number[]): boolean {
  const userId = typeof user?.id === "number" && Number.isInteger(user.id) ? user.id : null;
  const allowed = allowedUserIdSet(allowedUserIds);
  if (!userId || (allowed && !allowed.has(userId))) return false;
  const username = cleanOptionalText(user?.username);
  const firstName = cleanOptionalText(user?.first_name);
  const lastName = cleanOptionalText(user?.last_name);
  const displayName = buildDisplayName(firstName, lastName, username);
  const next = {
    username,
    firstName,
    lastName,
    displayName,
    lastSeenAt: new Date().toISOString(),
  };
  const key = String(userId);
  const previous = state.telegramUsers[key];
  const changed = !previous
    || previous.username !== next.username
    || previous.firstName !== next.firstName
    || previous.lastName !== next.lastName
    || previous.displayName !== next.displayName;
  state.telegramUsers[key] = changed ? next : { ...previous, lastSeenAt: next.lastSeenAt };
  return changed;
}

export function rememberTelegramChat(chat: TelegramChatInput | null | undefined): boolean {
  const chatId = typeof chat?.id === "number" && Number.isInteger(chat.id) ? chat.id : null;
  const type = cleanOptionalText(chat?.type) || null;
  if (chatId == null || !type) return false;
  const next = {
    type,
    title: cleanOptionalText(chat?.title),
    username: cleanOptionalText(chat?.username),
    lastSeenAt: new Date().toISOString(),
  };
  const key = String(chatId);
  const previous = state.telegramChats[key];
  const changed = !previous
    || previous.type !== next.type
    || previous.title !== next.title
    || previous.username !== next.username;
  state.telegramChats[key] = changed ? next : { ...previous, lastSeenAt: next.lastSeenAt };
  return changed;
}

export function listKnownTelegramUsers(allowedUserIds?: number[]): KnownTelegramUser[] {
  const allowed = allowedUserIdSet(allowedUserIds);
  return Object.entries(state.telegramUsers)
    .filter(([id]) => !allowed || allowed.has(Number(id)))
    .map(([id, value]) => ({
      id: Number(id),
      username: value.username,
      firstName: value.firstName,
      lastName: value.lastName,
      displayName: value.displayName,
      lastSeenAt: value.lastSeenAt,
    }))
    .filter((item) => Number.isInteger(item.id))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function getTelegramUserDisplayName(userId: number | undefined, allowedUserIds?: number[]): string | null {
  const allowed = allowedUserIdSet(allowedUserIds);
  if (!userId || (allowed && !allowed.has(userId))) return null;
  const user = state.telegramUsers[String(userId)];
  if (!user) return null;
  return user.username ? `${user.displayName} (@${user.username})` : user.displayName;
}

export function findTelegramUsers(input: { id?: number; username?: string; displayName?: string }, allowedUserIds?: number[]): KnownTelegramUser[] {
  const allowed = allowedUserIdSet(allowedUserIds);
  if (typeof input.id === "number" && Number.isInteger(input.id)) {
    if (allowed && !allowed.has(input.id)) return [];
    const direct = state.telegramUsers[String(input.id)];
    if (direct) {
      return [{
        id: input.id,
        username: direct.username,
        firstName: direct.firstName,
        lastName: direct.lastName,
        displayName: direct.displayName,
        lastSeenAt: direct.lastSeenAt,
      }];
    }
    return [];
  }

  const candidates = [input.username, input.displayName]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map(normalizeLookupKey);
  if (candidates.length === 0) return [];

  return listKnownTelegramUsers(allowedUserIds).filter((user) => {
    const keys = new Set(
      [
        user.username,
        user.displayName,
        user.firstName,
        user.lastName,
        [user.firstName, user.lastName].filter(Boolean).join(" "),
      ]
        .filter((item): item is string => Boolean(item && item.trim()))
        .map(normalizeLookupKey),
    );
    return candidates.some((candidate) => keys.has(candidate));
  });
}

export function listKnownTelegramChats(): KnownTelegramChat[] {
  return Object.entries(state.telegramChats)
    .map(([id, value]) => ({
      id: Number(id),
      type: value.type,
      title: value.title,
      username: value.username,
      lastSeenAt: value.lastSeenAt,
    }))
    .filter((item) => Number.isInteger(item.id))
    .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
}

export function findTelegramChats(input: { id?: number; username?: string; displayName?: string }): KnownTelegramChat[] {
  if (typeof input.id === "number" && Number.isInteger(input.id)) {
    const direct = state.telegramChats[String(input.id)];
    return direct ? [{ id: input.id, type: direct.type, title: direct.title, username: direct.username, lastSeenAt: direct.lastSeenAt }] : [];
  }

  const candidates = [input.username, input.displayName]
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map(normalizeLookupKey);
  if (candidates.length === 0) return [];

  return listKnownTelegramChats().filter((chat) => {
    const keys = new Set(
      [chat.username, chat.title]
        .filter((item): item is string => Boolean(item && item.trim()))
        .map(normalizeLookupKey),
    );
    return candidates.some((candidate) => keys.has(candidate));
  });
}
