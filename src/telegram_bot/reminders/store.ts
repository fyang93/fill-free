import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../types";
import { getAccurateNow } from "../time";
import { getUserTimezone } from "../state";
import { normalizeStoredReminderSchedule } from "./schedule_parser";
import type { ReminderEvent, ReminderEventKind, ReminderNotification, ReminderRecipient, ReminderSchedule, ReminderSpecialKind, ReminderStoreV2, ReminderTimeSemantics } from "./types";

export type ReminderEventDraft = {
  title: string;
  note?: string;
  schedule: ReminderSchedule;
  category?: "routine" | "special";
  specialKind?: ReminderSpecialKind;
  kind?: ReminderEventKind;
  timeSemantics?: ReminderTimeSemantics;
  timezone?: string;
  notifications?: ReminderNotification[];
  status?: ReminderEvent["status"];
  createdAt?: string;
  updatedAt?: string;
  recipients?: ReminderRecipient[];
  deliveryText?: string;
  deliveryTextGeneratedAt?: string;
  deliveryPreparedNotificationId?: string;
  deliveryPreparedNotifyAt?: string;
  deliveryState?: ReminderEvent["deliveryState"];
};

let reminderStoreWriteQueue: Promise<void> = Promise.resolve();

const DEFAULT_TIMEZONE = "Asia/Tokyo";

export function isValidReminderTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveReminderTimezone(
  _config: AppConfig,
  input: { explicitTimezone?: string; telegramMessageTime?: string; timeSemantics?: ReminderTimeSemantics; userId?: number },
): string {
  const explicitTimezone = input.explicitTimezone?.trim();
  if (explicitTimezone && isValidReminderTimezone(explicitTimezone)) {
    return explicitTimezone;
  }
  const rememberedTimezone = getUserTimezone(input.userId);
  if (rememberedTimezone && isValidReminderTimezone(rememberedTimezone)) {
    return rememberedTimezone;
  }
  if (input.telegramMessageTime) {
    return DEFAULT_TIMEZONE;
  }
  return DEFAULT_TIMEZONE;
}

export function defaultReminderEventKind(input: { category?: "routine" | "special"; specialKind?: ReminderSpecialKind; kind?: ReminderEventKind; schedule?: ReminderSchedule }): ReminderEventKind {
  if (input.kind) return input.kind;
  if (input.specialKind) return input.specialKind;
  if (input.schedule?.kind === "once") return "task";
  return input.category === "special" ? "custom" : "routine";
}

export function defaultReminderTimeSemantics(kind: ReminderEventKind, schedule: ReminderSchedule): ReminderTimeSemantics {
  if (kind === "meeting") return "absolute";
  if (schedule.kind === "once") return "absolute";
  return "local";
}

export function buildDefaultReminderNotifications(kind: ReminderEventKind): ReminderNotification[] {
  if (kind === "meeting") {
    return [{ id: "default-1h", offsetMinutes: -60, enabled: true, label: "提前1小时" }];
  }
  if (kind === "birthday" || kind === "anniversary" || kind === "festival" || kind === "memorial") {
    return [
      { id: "default-2w", offsetMinutes: -14 * 24 * 60, enabled: true, label: "提前2周" },
      { id: "default-1w", offsetMinutes: -7 * 24 * 60, enabled: true, label: "提前1周" },
      { id: "default-1d", offsetMinutes: -24 * 60, enabled: true, label: "提前1天" },
      { id: "default-now", offsetMinutes: 0, enabled: true, label: "当天" },
    ];
  }
  return [{ id: "default-now", offsetMinutes: 0, enabled: true, label: "准时" }];
}

function remindersPath(config: AppConfig): string {
  return path.join(config.paths.repoRoot, "system", "reminders.json");
}

function normalizeRecipient(raw: unknown): ReminderRecipient | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const userId = Number(record.userId);
  const displayName = typeof record.displayName === "string" && record.displayName.trim() ? record.displayName.trim() : undefined;
  if (!Number.isInteger(userId)) return null;
  return { userId, displayName };
}

function normalizeNotification(raw: unknown): ReminderNotification | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : "";
  const offsetMinutes = Number(record.offsetMinutes);
  const enabled = record.enabled !== false;
  const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : undefined;
  if (!id || !Number.isInteger(offsetMinutes)) return null;
  return { id, offsetMinutes, enabled, label };
}

function normalizeEventSchedule(raw: unknown): ReminderSchedule | null {
  return normalizeStoredReminderSchedule(raw);
}

function normalizeEvent(raw: unknown): ReminderEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : "";
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : "";
  const note = typeof record.note === "string" && record.note.trim() ? record.note.trim() : undefined;
  const kind = record.kind === "routine" || record.kind === "meeting" || record.kind === "birthday" || record.kind === "anniversary" || record.kind === "festival" || record.kind === "memorial" || record.kind === "task" || record.kind === "custom" ? record.kind : "custom";
  const timeSemantics = record.timeSemantics === "absolute" || record.timeSemantics === "local" ? record.timeSemantics : undefined;
  const timezone = typeof record.timezone === "string" && record.timezone.trim() ? record.timezone.trim() : DEFAULT_TIMEZONE;
  const schedule = normalizeEventSchedule(record.schedule);
  const notifications = Array.isArray(record.notifications) ? record.notifications.map(normalizeNotification).filter((item): item is ReminderNotification => Boolean(item)) : [];
  const status = record.status === "active" || record.status === "paused" || record.status === "deleted" ? record.status : "active";
  const createdAt = typeof record.createdAt === "string" && record.createdAt.trim() ? record.createdAt.trim() : "";
  const updatedAt = typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt.trim() : undefined;
  const category = record.category === "special" ? "special" : "routine";
  const specialKind = record.specialKind === "birthday" || record.specialKind === "festival" || record.specialKind === "anniversary" || record.specialKind === "memorial" ? record.specialKind : undefined;
  const recipients = Array.isArray(record.recipients)
    ? record.recipients.map(normalizeRecipient).filter((item): item is ReminderRecipient => Boolean(item))
    : [];
  const deliveryText = typeof record.deliveryText === "string" && record.deliveryText.trim() ? record.deliveryText.trim() : undefined;
  const deliveryTextGeneratedAt = typeof record.deliveryTextGeneratedAt === "string" && record.deliveryTextGeneratedAt.trim() ? record.deliveryTextGeneratedAt.trim() : undefined;
  const deliveryPreparedNotificationId = typeof record.deliveryPreparedNotificationId === "string" && record.deliveryPreparedNotificationId.trim() ? record.deliveryPreparedNotificationId.trim() : undefined;
  const deliveryPreparedNotifyAt = typeof record.deliveryPreparedNotifyAt === "string" && record.deliveryPreparedNotifyAt.trim() ? record.deliveryPreparedNotifyAt.trim() : undefined;
  const deliveryState = record.deliveryState && typeof record.deliveryState === "object" ? record.deliveryState as ReminderEvent["deliveryState"] : undefined;
  if (!id || !title || !schedule || !createdAt || notifications.length === 0 || recipients.length === 0) return null;
  return {
    id,
    title,
    note,
    kind,
    timeSemantics: timeSemantics || defaultReminderTimeSemantics(kind, schedule),
    timezone,
    schedule,
    notifications,
    category,
    specialKind,
    status,
    createdAt,
    updatedAt,
    recipients,
    deliveryText,
    deliveryTextGeneratedAt,
    deliveryPreparedNotificationId,
    deliveryPreparedNotifyAt,
    deliveryState,
  };
}

function parseReminderStore(raw: unknown): ReminderStoreV2 {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeEvent).filter((item): item is ReminderEvent => Boolean(item));
}

async function loadReminderStore(config: AppConfig): Promise<ReminderStoreV2> {
  const filePath = remindersPath(config);
  try {
    const rawText = await readFile(filePath, "utf8");
    const parsed = JSON.parse(rawText) as unknown;
    return parseReminderStore(parsed);
  } catch {
    return [];
  }
}

async function writeReminderStore(config: AppConfig, store: ReminderStoreV2): Promise<void> {
  const filePath = remindersPath(config);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(store, null, 2), "utf8");
}

function queueReminderStoreWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = reminderStoreWriteQueue.then(operation, operation);
  reminderStoreWriteQueue = next.then(() => undefined, () => undefined);
  return next;
}

export async function readReminderEvents(config: AppConfig): Promise<ReminderEvent[]> {
  return loadReminderStore(config);
}

export async function writeReminderEvents(config: AppConfig, events: ReminderEvent[]): Promise<void> {
  await queueReminderStoreWrite(() => writeReminderStore(config, events));
}

export function buildReminderEvent(draft: ReminderEventDraft): ReminderEvent {
  const kind = defaultReminderEventKind({
    category: draft.category,
    specialKind: draft.specialKind,
    kind: draft.kind,
    schedule: draft.schedule,
  });
  return {
    id: `rmd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: draft.title,
    note: draft.note,
    kind,
    timeSemantics: draft.timeSemantics || defaultReminderTimeSemantics(kind, draft.schedule),
    timezone: draft.timezone || DEFAULT_TIMEZONE,
    schedule: draft.schedule,
    notifications: draft.notifications && draft.notifications.length > 0 ? draft.notifications : buildDefaultReminderNotifications(kind),
    category: draft.category,
    specialKind: draft.specialKind,
    status: draft.status || "active",
    createdAt: draft.createdAt || new Date().toISOString(),
    updatedAt: draft.updatedAt,
    recipients: draft.recipients && draft.recipients.length > 0 ? draft.recipients : [],
    deliveryText: draft.deliveryText,
    deliveryTextGeneratedAt: draft.deliveryTextGeneratedAt,
    deliveryPreparedNotificationId: draft.deliveryPreparedNotificationId,
    deliveryPreparedNotifyAt: draft.deliveryPreparedNotifyAt,
    deliveryState: draft.deliveryState,
  };
}

export async function createReminderEvent(event: ReminderEvent, config: AppConfig): Promise<ReminderEvent> {
  await queueReminderStoreWrite(async () => {
    const events = await loadReminderStore(config);
    events.push(event);
    await writeReminderStore(config, events);
  });
  return event;
}

export async function createReminderEventWithDefaults(config: AppConfig, draft: ReminderEventDraft): Promise<ReminderEvent> {
  const event = buildReminderEvent(draft);
  return createReminderEvent(event, config);
}

export async function getReminderEvent(config: AppConfig, id: string): Promise<ReminderEvent | null> {
  const events = await readReminderEvents(config);
  return events.find((item) => item.id === id) || null;
}

export async function updateReminderEvent(config: AppConfig, event: ReminderEvent): Promise<void> {
  await queueReminderStoreWrite(async () => {
    const events = await loadReminderStore(config);
    const next = events.map((item) => (item.id === event.id ? event : item));
    await writeReminderStore(config, next);
  });
}

export async function deleteReminderEvent(config: AppConfig, id: string): Promise<boolean> {
  return queueReminderStoreWrite(async () => {
    const events = await loadReminderStore(config);
    let changed = false;
    const next = events.map((item) => {
      if (item.id === id && item.status !== "deleted") {
        changed = true;
        return { ...item, status: "deleted" as const, updatedAt: new Date().toISOString() };
      }
      return item;
    });
    if (changed) await writeReminderStore(config, next);
    return changed;
  });
}

export async function pruneInactiveReminderEvents(config: AppConfig): Promise<{ removed: number; removedIds: string[] }> {
  return queueReminderStoreWrite(async () => {
    const events = await loadReminderStore(config);
    const now = await getAccurateNow();
    const removedIds: string[] = [];
    const next = events.filter((event) => {
      if (event.status === "deleted") {
        removedIds.push(event.id);
        return false;
      }
      if (event.status === "paused" && event.schedule.kind === "once") {
        const scheduledAt = Date.parse(event.schedule.scheduledAt);
        if (Number.isFinite(scheduledAt) && scheduledAt <= now.getTime()) {
          removedIds.push(event.id);
          return false;
        }
      }
      return true;
    });
    if (removedIds.length > 0) await writeReminderStore(config, next);
    return { removed: removedIds.length, removedIds };
  });
}

export async function pruneExpiredReminderEvents(config: AppConfig): Promise<{ removed: number; removedIds: string[] }> {
  return queueReminderStoreWrite(async () => {
    const events = await loadReminderStore(config);
    const now = await getAccurateNow();
    const removedIds: string[] = [];
    const next = events.filter((event) => {
      if (event.schedule.kind !== "once") return true;
      const scheduledAt = Date.parse(event.schedule.scheduledAt);
      if (!Number.isFinite(scheduledAt) || scheduledAt > now.getTime()) return true;
      removedIds.push(event.id);
      return false;
    });
    if (removedIds.length > 0) await writeReminderStore(config, next);
    return { removed: removedIds.length, removedIds };
  });
}

