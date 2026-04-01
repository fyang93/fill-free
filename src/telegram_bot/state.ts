import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionState, UploadedFile } from "./types";

const RECENT_UPLOADS_TTL_MS = 30 * 60 * 1000;

export const state: SessionState = {
  sessionId: null,
  model: null,
  lastActivityAt: null,
  recentUploads: [],
  recentUploadsAt: null,
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
  } catch {
    state.model = null;
    state.userTimezones = {};
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

export function rememberUploads(files: UploadedFile[]): void {
  state.recentUploads = files;
  state.recentUploadsAt = new Date().toISOString();
}

export function retainRecentUploads(files: UploadedFile[]): void {
  state.recentUploads = files;
  if (files.length === 0) {
    state.recentUploadsAt = null;
  }
}

export function clearRecentUploads(): void {
  state.recentUploads = [];
  state.recentUploadsAt = null;
}

export function hasRecentUploads(): boolean {
  return state.recentUploads.length > 0;
}

export function getRecentUploads(): UploadedFile[] {
  if (!state.recentUploadsAt) return [];
  const ageMs = Date.now() - new Date(state.recentUploadsAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > RECENT_UPLOADS_TTL_MS) {
    clearRecentUploads();
    return [];
  }
  return state.recentUploads;
}
