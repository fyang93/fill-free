import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionState, UploadedFile } from "./types";

const RECENT_UPLOADS_TTL_MS = 30 * 60 * 1000;

type TelegramUserInput = {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
};

type KnownTelegramUser = {
  id: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  displayName: string;
  lastSeenAt: string;
};

function allowedUserIdSet(allowedUserIds?: number[]): Set<number> | null {
  return allowedUserIds && allowedUserIds.length > 0 ? new Set(allowedUserIds) : null;
}

export const state: SessionState = {
  model: null,
  lastActivityAt: null,
  lastDreamedAt: null,
  lastDreamedMemoryFingerprint: null,
  recentUploadsByScope: {},
  userTimezones: {},
  telegramUsers: {},
};

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

export async function loadPersistentState(filePath: string): Promise<void> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { model?: unknown; lastDreamedAt?: unknown; lastDreamedMemoryFingerprint?: unknown; userTimezones?: unknown; telegramUsers?: unknown };
    state.model = typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : null;
    state.lastDreamedAt = typeof parsed.lastDreamedAt === "string" && parsed.lastDreamedAt.trim() ? parsed.lastDreamedAt.trim() : null;
    state.lastDreamedMemoryFingerprint = typeof parsed.lastDreamedMemoryFingerprint === "string" && parsed.lastDreamedMemoryFingerprint.trim() ? parsed.lastDreamedMemoryFingerprint.trim() : null;
    state.userTimezones = parsed.userTimezones && typeof parsed.userTimezones === "object"
      ? Object.fromEntries(
          Object.entries(parsed.userTimezones as Record<string, unknown>)
            .map(([userId, value]) => {
              const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
              const timezone = typeof record.timezone === "string" && record.timezone.trim() ? record.timezone.trim() : "";
              const updatedAt = typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt.trim() : new Date().toISOString();
              return timezone ? [userId, { timezone, updatedAt }] : null;
            })
            .filter((item): item is [string, { timezone: string; updatedAt: string }] => Boolean(item)),
        )
      : {};
    if (parsed.telegramUsers && typeof parsed.telegramUsers === "object") {
      const telegramUsers: SessionState["telegramUsers"] = {};
      for (const [userId, value] of Object.entries(parsed.telegramUsers as Record<string, unknown>)) {
        if (!/^[0-9]+$/.test(userId)) continue;
        const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
        const username = cleanOptionalText(record.username);
        const firstName = cleanOptionalText(record.firstName);
        const lastName = cleanOptionalText(record.lastName);
        const displayName = cleanOptionalText(record.displayName) || buildDisplayName(firstName, lastName, username);
        const lastSeenAt = cleanOptionalText(record.lastSeenAt) || new Date().toISOString();
        telegramUsers[userId] = { username, firstName, lastName, displayName, lastSeenAt };
      }
      state.telegramUsers = telegramUsers;
    } else {
      state.telegramUsers = {};
    }
    state.recentUploadsByScope = {};
  } catch {
    state.model = null;
    state.lastDreamedAt = null;
    state.lastDreamedMemoryFingerprint = null;
    state.userTimezones = {};
    state.telegramUsers = {};
    state.recentUploadsByScope = {};
  }
}

export async function persistState(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify({ model: state.model, lastDreamedAt: state.lastDreamedAt, lastDreamedMemoryFingerprint: state.lastDreamedMemoryFingerprint, userTimezones: state.userTimezones, telegramUsers: state.telegramUsers }, null, 2) + "\n",
    "utf8",
  );
}

export function touchActivity(): void {
  state.lastActivityAt = new Date().toISOString();
}

export function currentModel(): string {
  return state.model || "project default";
}

export function getUserTimezone(userId: number | undefined): string | null {
  if (!userId) return null;
  return state.userTimezones[String(userId)]?.timezone || null;
}

export function rememberUserTimezone(userId: number | undefined, timezone: string): void {
  if (!userId || !timezone.trim()) return;
  state.userTimezones[String(userId)] = { timezone: timezone.trim(), updatedAt: new Date().toISOString() };
}

export function rememberTelegramUser(user: TelegramUserInput | null | undefined, allowedUserIds?: number[]): boolean {
  const userId = typeof user?.id === "number" && Number.isInteger(user.id) ? user.id : null;
  const allowed = allowedUserIdSet(allowedUserIds);
  if (!userId || (allowed && !allowed.has(userId))) return false;
  const username = cleanOptionalText(user?.username);
  const firstName = cleanOptionalText(user?.first_name);
  const lastName = cleanOptionalText(user?.last_name);
  const displayName = buildDisplayName(firstName, lastName, username);
  const next: SessionState["telegramUsers"][string] = {
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

export function findTelegramUser(input: { id?: number; username?: string; displayName?: string }, allowedUserIds?: number[]): KnownTelegramUser | null {
  return findTelegramUsers(input, allowedUserIds)[0] || null;
}

function uploadsKey(scopeKey: string | undefined): string {
  return scopeKey?.trim() || "global";
}

export function rememberUploads(scopeKey: string | undefined, files: UploadedFile[]): void {
  state.recentUploadsByScope[uploadsKey(scopeKey)] = { files, recentUploadsAt: new Date().toISOString() };
}

export function retainRecentUploads(scopeKey: string | undefined, files: UploadedFile[]): void {
  const key = uploadsKey(scopeKey);
  state.recentUploadsByScope[key] = {
    files,
    recentUploadsAt: files.length === 0 ? null : (state.recentUploadsByScope[key]?.recentUploadsAt || new Date().toISOString()),
  };
}

export function clearRecentUploads(scopeKey?: string): void {
  if (scopeKey) {
    delete state.recentUploadsByScope[uploadsKey(scopeKey)];
    return;
  }
  state.recentUploadsByScope = {};
}

export function hasRecentUploads(scopeKey?: string): boolean {
  return getRecentUploads(scopeKey).length > 0;
}

export function getRecentUploads(scopeKey?: string): UploadedFile[] {
  const bucket = state.recentUploadsByScope[uploadsKey(scopeKey)];
  if (!bucket?.recentUploadsAt) return [];
  const ageMs = Date.now() - new Date(bucket.recentUploadsAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > RECENT_UPLOADS_TTL_MS) {
    clearRecentUploads(scopeKey);
    return [];
  }
  return bucket.files;
}
