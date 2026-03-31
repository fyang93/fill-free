import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PendingReminderConfirmation, SessionState, UploadedFile } from "./types";

const STATE_FILE = path.resolve(process.cwd(), "index/telegram-state.json");
const RECENT_UPLOADS_TTL_MS = 30 * 60 * 1000;
const PENDING_REMINDER_TTL_MS = 12 * 60 * 60 * 1000;

export const state: SessionState = {
  sessionId: null,
  model: null,
  lastActivityAt: null,
  recentUploads: [],
  recentUploadsAt: null,
  pendingReminderConfirmation: null,
};

export async function loadPersistentState(): Promise<void> {
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as { model?: unknown; pendingReminderConfirmation?: unknown };
    state.model = typeof parsed.model === "string" && parsed.model.trim() ? parsed.model.trim() : null;
    state.pendingReminderConfirmation = parsePendingReminderConfirmation(parsed.pendingReminderConfirmation);
  } catch {
    state.model = null;
    state.pendingReminderConfirmation = null;
  }
}

export async function persistState(): Promise<void> {
  await mkdir(path.dirname(STATE_FILE), { recursive: true });
  await writeFile(
    STATE_FILE,
    JSON.stringify({ model: state.model, pendingReminderConfirmation: state.pendingReminderConfirmation }, null, 2) + "\n",
    "utf8",
  );
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

function parsePendingReminderConfirmation(value: unknown): PendingReminderConfirmation | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const originalRequest = typeof record.originalRequest === "string" ? record.originalRequest.trim() : "";
  const referenceTimeIso = typeof record.referenceTimeIso === "string" ? record.referenceTimeIso.trim() : "";
  const confirmationText = typeof record.confirmationText === "string" ? record.confirmationText.trim() : "";
  const createdAt = typeof record.createdAt === "string" ? record.createdAt.trim() : "";
  if (!originalRequest || !referenceTimeIso || !confirmationText || !createdAt) return null;
  return { originalRequest, referenceTimeIso, confirmationText, createdAt };
}

export function getPendingReminderConfirmation(): PendingReminderConfirmation | null {
  const pending = state.pendingReminderConfirmation;
  if (!pending) return null;
  const ageMs = Date.now() - new Date(pending.createdAt).getTime();
  if (!Number.isFinite(ageMs) || ageMs > PENDING_REMINDER_TTL_MS) {
    state.pendingReminderConfirmation = null;
    void persistState();
    return null;
  }
  return pending;
}

export async function setPendingReminderConfirmation(pending: PendingReminderConfirmation): Promise<void> {
  state.pendingReminderConfirmation = pending;
  await persistState();
}

export async function clearPendingReminderConfirmation(): Promise<void> {
  state.pendingReminderConfirmation = null;
  await persistState();
}
