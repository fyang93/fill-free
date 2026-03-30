import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SessionState, UploadedFile } from "./types";

const STATE_FILE = path.resolve(process.cwd(), "index/telegram-state.json");
const RECENT_UPLOADS_TTL_MS = 30 * 60 * 1000;

export const state: SessionState = {
  sessionId: null,
  model: null,
  lastActivityAt: null,
  recentUploads: [],
  recentUploadsAt: null,
};

export async function loadPersistentState(): Promise<void> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as { model?: unknown };
    state.model = typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : null;
  } catch {
    state.model = null;
  }
}

export async function persistState(): Promise<void> {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify({ model: state.model }, null, 2) + "\n", "utf8");
}

export function touchActivity(): void {
  state.lastActivityAt = new Date().toISOString();
}

export function currentModel(): string {
  return state.model || "project default";
}

export function rememberUploads(files: UploadedFile[]): void {
  state.recentUploads = files;
  state.recentUploadsAt = new Date().toISOString();
}

export function clearRecentUploads(): void {
  state.recentUploads = [];
  state.recentUploadsAt = null;
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
