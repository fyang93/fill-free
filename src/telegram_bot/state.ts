import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionState, UploadedFile } from "./types";

const RECENT_UPLOADS_TTL_MS = 30 * 60 * 1000;

export const state: SessionState = {
  model: null,
  lastActivityAt: null,
  recentUploadsByScope: {},
  userTimezones: {},
};

export async function loadPersistentState(filePath: string): Promise<void> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as { model?: unknown; userTimezones?: unknown };
    state.model = typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : null;
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
    state.recentUploadsByScope = {};
  } catch {
    state.model = null;
    state.userTimezones = {};
    state.recentUploadsByScope = {};
  }
}

export async function persistState(filePath: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(
    filePath,
    JSON.stringify({ model: state.model, userTimezones: state.userTimezones }, null, 2) + "\n",
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
