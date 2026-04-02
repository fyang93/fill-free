import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PendingAuthorization, SessionState, UploadedFile } from "./types";

const RECENT_UPLOADS_TTL_MS = 30 * 60 * 1000;


export const state: SessionState = {
  model: null,
  lastActivityAt: null,
  lastDreamedAt: null,
  lastDreamedMemoryFingerprint: null,
  recentUploadsByScope: {},
  userTimezones: {},
  telegramUsers: {},
  telegramChats: {},
  pendingAuthorizations: [],
};

function cleanOptionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function normalizeLookupKey(value: string): string {
  return value.trim().replace(/^@+/, "").toLowerCase();
}

function normalizePendingAuthorization(value: unknown): PendingAuthorization | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const kind = record.kind === "allowed" ? "allowed" : null;
  const username = cleanOptionalText(record.username)?.replace(/^@+/, "").toLowerCase();
  const createdBy = Number(record.createdBy);
  const createdAt = cleanOptionalText(record.createdAt);
  const expiresAt = cleanOptionalText(record.expiresAt);
  if (!kind || !username || !Number.isInteger(createdBy) || !createdAt || !expiresAt) return null;
  return { kind, username, createdBy, createdAt, expiresAt };
}

export async function loadPersistentState(filePath: string): Promise<void> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { model?: unknown; lastDreamedAt?: unknown; lastDreamedMemoryFingerprint?: unknown; userTimezones?: unknown; telegramUsers?: unknown; telegramChats?: unknown; pendingAuthorizations?: unknown };
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
        const displayName = cleanOptionalText(record.displayName) || [firstName, lastName].filter(Boolean).join(" ").trim() || (username ? `@${username}` : "Telegram user");
        const lastSeenAt = cleanOptionalText(record.lastSeenAt) || new Date().toISOString();
        telegramUsers[userId] = { username, firstName, lastName, displayName, lastSeenAt };
      }
      state.telegramUsers = telegramUsers;
    } else {
      state.telegramUsers = {};
    }
    if (parsed.telegramChats && typeof parsed.telegramChats === "object") {
      const telegramChats: SessionState["telegramChats"] = {};
      for (const [chatId, value] of Object.entries(parsed.telegramChats as Record<string, unknown>)) {
        if (!/^-?[0-9]+$/.test(chatId)) continue;
        const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
        const type = cleanOptionalText(record.type) || "private";
        const title = cleanOptionalText(record.title);
        const username = cleanOptionalText(record.username);
        const lastSeenAt = cleanOptionalText(record.lastSeenAt) || new Date().toISOString();
        telegramChats[chatId] = { type, title, username, lastSeenAt };
      }
      state.telegramChats = telegramChats;
    } else {
      state.telegramChats = {};
    }
    state.pendingAuthorizations = Array.isArray(parsed.pendingAuthorizations)
      ? parsed.pendingAuthorizations.map(normalizePendingAuthorization).filter((item): item is PendingAuthorization => Boolean(item))
      : [];
    state.recentUploadsByScope = {};
  } catch {
    state.model = null;
    state.lastDreamedAt = null;
    state.lastDreamedMemoryFingerprint = null;
    state.userTimezones = {};
    state.telegramUsers = {};
    state.telegramChats = {};
    state.pendingAuthorizations = [];
    state.recentUploadsByScope = {};
  }
}

export async function persistState(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify({ model: state.model, lastDreamedAt: state.lastDreamedAt, lastDreamedMemoryFingerprint: state.lastDreamedMemoryFingerprint, userTimezones: state.userTimezones, telegramUsers: state.telegramUsers, telegramChats: state.telegramChats, pendingAuthorizations: state.pendingAuthorizations }, null, 2) + "\n",
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

export function rememberPendingAuthorization(input: PendingAuthorization): void {
  const username = normalizeLookupKey(input.username);
  state.pendingAuthorizations = state.pendingAuthorizations.filter((item) => !(item.kind === input.kind && item.username === username));
  state.pendingAuthorizations.push({ ...input, username });
}

export function pruneExpiredPendingAuthorizations(now = new Date()): number {
  const before = state.pendingAuthorizations.length;
  state.pendingAuthorizations = state.pendingAuthorizations.filter((item) => {
    const expiresAt = Date.parse(item.expiresAt);
    return Number.isFinite(expiresAt) && expiresAt > now.getTime();
  });
  return before - state.pendingAuthorizations.length;
}

export function consumePendingAllowedAuthorization(username: string | undefined, now = new Date()): PendingAuthorization | null {
  const normalized = normalizeLookupKey(username || "");
  if (!normalized) return null;
  pruneExpiredPendingAuthorizations(now);
  const index = state.pendingAuthorizations.findIndex((item) => item.kind === "allowed" && item.username === normalized);
  if (index < 0) return null;
  const [match] = state.pendingAuthorizations.splice(index, 1);
  return match || null;
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
