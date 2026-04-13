import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "bot/app/types";
import { getAccurateNow } from "bot/app/time";
import { getUserTimezone } from "bot/app/state";
import { buildScheduledTaskPrompt } from "./scheduled-task";
import { getCurrentOccurrence, scheduleEventScheduleSummary } from "./schedule";
import { normalizeStoredScheduleSchedule } from "./schedule_parser";
import type { ScheduleEvent, ScheduleNotification, ScheduleSchedule, ScheduleSpecialKind, ScheduleStore, ScheduleTarget, ScheduleTimeSemantics } from "./types";

export type ScheduleEventDraft = {
  title: string;
  note?: string;
  schedule: ScheduleSchedule;
  category?: "routine" | "special" | "scheduled-task";
  specialKind?: ScheduleSpecialKind;
  timeSemantics?: ScheduleTimeSemantics;
  createdByUserId?: number;
  notifications?: ScheduleNotification[];
  status?: ScheduleEvent["status"];
  createdAt?: string;
  updatedAt?: string;
  targets?: ScheduleTarget[];
  deliveryText?: string;
  deliveryTextGeneratedAt?: string;
  deliveryPreparedNotificationId?: string;
  deliveryPreparedNotifyAt?: string;
  deliveryState?: ScheduleEvent["deliveryState"];
};

let scheduleStoreWriteQueue: Promise<void> = Promise.resolve();

function defaultScheduleTimezone(config: AppConfig): string {
  return config.bot.defaultTimezone;
}

export function isValidScheduleTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveScheduleTimezone(
  _config: AppConfig,
  input: {
    explicitTimezone?: string;
    subjectTimezone?: string;
    messageTime?: string;
    timeSemantics?: ScheduleTimeSemantics;
    recipientUserId?: number;
    userId?: number;
  },
): string {
  const explicitTimezone = input.explicitTimezone?.trim();
  if (explicitTimezone && isValidScheduleTimezone(explicitTimezone)) {
    return explicitTimezone;
  }

  if (input.timeSemantics === "local") {
    const subjectTimezone = input.subjectTimezone?.trim();
    if (subjectTimezone && isValidScheduleTimezone(subjectTimezone)) {
      return subjectTimezone;
    }

    const recipientTimezone = getUserTimezone(input.recipientUserId);
    if (recipientTimezone && isValidScheduleTimezone(recipientTimezone)) {
      return recipientTimezone;
    }
  }

  const rememberedTimezone = getUserTimezone(input.userId);
  if (rememberedTimezone && isValidScheduleTimezone(rememberedTimezone)) {
    return rememberedTimezone;
  }
  if (input.messageTime) {
    return defaultScheduleTimezone(_config);
  }
  return defaultScheduleTimezone(_config);
}

export function defaultScheduleTimeSemantics(schedule: ScheduleSchedule): ScheduleTimeSemantics {
  if (schedule.kind === "once") return "absolute";
  return "local";
}

export function buildDefaultScheduleNotifications(_config: AppConfig, input: { specialKind?: ScheduleSpecialKind }): ScheduleNotification[] {
  if (input.specialKind === "birthday" || input.specialKind === "anniversary" || input.specialKind === "festival" || input.specialKind === "memorial") {
    return [
      { id: "default-2w", offsetMinutes: -14 * 24 * 60, enabled: true, label: "提前2周" },
      { id: "default-1w", offsetMinutes: -7 * 24 * 60, enabled: true, label: "提前1周" },
      { id: "default-1d", offsetMinutes: -24 * 60, enabled: true, label: "提前1天" },
      { id: "default-now", offsetMinutes: 0, enabled: true, label: "当天" },
    ];
  }
  return [{ id: "default-now", offsetMinutes: 0, enabled: true, label: "准时" }];
}

function schedulesPath(config: AppConfig): string {
  return path.join(config.paths.repoRoot, "system", "schedules.json");
}

function normalizeTarget(raw: unknown): ScheduleTarget | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const targetKind = record.targetKind === "chat" ? "chat" : record.targetKind === "user" ? "user" : null;
  const targetId = Number(record.targetId);
  if (!targetKind || !Number.isInteger(targetId)) return null;
  return { targetKind, targetId };
}

function normalizeNotification(raw: unknown): ScheduleNotification | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : "";
  const offsetMinutes = Number(record.offsetMinutes);
  const enabled = record.enabled !== false;
  const label = typeof record.label === "string" && record.label.trim() ? record.label.trim() : undefined;
  if (!id || !Number.isInteger(offsetMinutes)) return null;
  return { id, offsetMinutes, enabled, label };
}

function normalizeEventSchedule(raw: unknown): ScheduleSchedule | null {
  return normalizeStoredScheduleSchedule(raw);
}

function normalizeEvent(raw: unknown, _fallbackTimezone = "Asia/Tokyo"): ScheduleEvent | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : "";
  const title = typeof record.title === "string" && record.title.trim() ? record.title.trim() : "";
  const rawNote = typeof record.note === "string" && record.note.trim() ? record.note.trim() : undefined;
  const legacySpecialKind = record.kind === "birthday" || record.kind === "festival" || record.kind === "anniversary" || record.kind === "memorial"
    ? record.kind
    : undefined;
  const timeSemantics = record.timeSemantics === "absolute" || record.timeSemantics === "local" ? record.timeSemantics : undefined;
  const schedule = normalizeEventSchedule(record.schedule);
  const createdByUserId = Number.isInteger(Number(record.createdByUserId))
    ? Number(record.createdByUserId)
    : Array.isArray(record.targets)
      ? record.targets
          .map(normalizeTarget)
          .filter((item): item is ScheduleTarget => Boolean(item))
          .find((item) => item.targetKind === "user")
          ?.targetId
      : undefined;
  const notifications = Array.isArray(record.notifications) ? record.notifications.map(normalizeNotification).filter((item): item is ScheduleNotification => Boolean(item)) : [];
  const status = record.status === "active" || record.status === "paused" || record.status === "deleted" ? record.status : "active";
  const createdAt = typeof record.createdAt === "string" && record.createdAt.trim() ? record.createdAt.trim() : "";
  const updatedAt = typeof record.updatedAt === "string" && record.updatedAt.trim() ? record.updatedAt.trim() : undefined;
  const specialKind = record.specialKind === "birthday" || record.specialKind === "festival" || record.specialKind === "anniversary" || record.specialKind === "memorial"
    ? record.specialKind
    : legacySpecialKind;
  const category = record.category === "scheduled-task" ? "scheduled-task" : record.category === "special" || specialKind ? "special" : "routine";
  const note = category === "scheduled-task" ? buildScheduledTaskPrompt(title, rawNote) : rawNote;
  const targets = Array.isArray(record.targets)
    ? record.targets.map(normalizeTarget).filter((item): item is ScheduleTarget => Boolean(item))
    : [];
  const deliveryText = typeof record.deliveryText === "string" && record.deliveryText.trim() ? record.deliveryText.trim() : undefined;
  const deliveryTextGeneratedAt = typeof record.deliveryTextGeneratedAt === "string" && record.deliveryTextGeneratedAt.trim() ? record.deliveryTextGeneratedAt.trim() : undefined;
  const deliveryPreparedNotificationId = typeof record.deliveryPreparedNotificationId === "string" && record.deliveryPreparedNotificationId.trim() ? record.deliveryPreparedNotificationId.trim() : undefined;
  const deliveryPreparedNotifyAt = typeof record.deliveryPreparedNotifyAt === "string" && record.deliveryPreparedNotifyAt.trim() ? record.deliveryPreparedNotifyAt.trim() : undefined;
  const deliveryState = record.deliveryState && typeof record.deliveryState === "object" ? record.deliveryState as ScheduleEvent["deliveryState"] : undefined;
  if (!id || !title || !schedule || !createdAt || notifications.length === 0 || targets.length === 0) return null;
  return {
    id,
    title,
    note,
    timeSemantics: timeSemantics || defaultScheduleTimeSemantics(schedule),
    createdByUserId,
    schedule,
    notifications,
    category,
    specialKind,
    status,
    createdAt,
    updatedAt,
    targets,
    deliveryText,
    deliveryTextGeneratedAt,
    deliveryPreparedNotificationId,
    deliveryPreparedNotifyAt,
    deliveryState,
  };
}

function parseScheduleStore(raw: unknown, fallbackTimezone = "Asia/Tokyo"): ScheduleStore {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => normalizeEvent(item, fallbackTimezone)).filter((item): item is ScheduleEvent => Boolean(item));
}

async function loadScheduleStore(config: AppConfig): Promise<ScheduleStore> {
  const filePath = schedulesPath(config);
  try {
    const rawText = await readFile(filePath, "utf8");
    const parsed = JSON.parse(rawText) as unknown;
    return parseScheduleStore(parsed, defaultScheduleTimezone(config));
  } catch {
    return [];
  }
}

async function writeScheduleStore(config: AppConfig, store: ScheduleStore): Promise<void> {
  const filePath = schedulesPath(config);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

function queueScheduleStoreWrite<T>(operation: () => Promise<T>): Promise<T> {
  const next = scheduleStoreWriteQueue.then(operation, operation);
  scheduleStoreWriteQueue = next.then(() => undefined, () => undefined);
  return next;
}

export async function readScheduleEvents(config: AppConfig): Promise<ScheduleEvent[]> {
  return loadScheduleStore(config);
}

export async function writeScheduleEvents(config: AppConfig, events: ScheduleEvent[]): Promise<void> {
  await queueScheduleStoreWrite(() => writeScheduleStore(config, events));
}

export function buildScheduleEvent(config: AppConfig, draft: ScheduleEventDraft): ScheduleEvent {
  const category = draft.category === "scheduled-task" ? "scheduled-task" : draft.category === "special" || draft.specialKind ? "special" : draft.category === "routine" ? "routine" : undefined;
  const note = category === "scheduled-task" ? buildScheduledTaskPrompt(draft.title, draft.note) : draft.note;
  return {
    id: `rmd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    title: draft.title,
    note,
    timeSemantics: draft.timeSemantics || defaultScheduleTimeSemantics(draft.schedule),
    createdByUserId: draft.createdByUserId,
    schedule: draft.schedule,
    notifications: draft.notifications && draft.notifications.length > 0 ? draft.notifications : buildDefaultScheduleNotifications(config, { specialKind: draft.specialKind }),
    category,
    specialKind: draft.specialKind,
    status: draft.status || "active",
    createdAt: draft.createdAt || new Date().toISOString(),
    updatedAt: draft.updatedAt,
    targets: draft.targets && draft.targets.length > 0 ? draft.targets : [],
    deliveryText: draft.deliveryText,
    deliveryTextGeneratedAt: draft.deliveryTextGeneratedAt,
    deliveryPreparedNotificationId: draft.deliveryPreparedNotificationId,
    deliveryPreparedNotifyAt: draft.deliveryPreparedNotifyAt,
    deliveryState: draft.deliveryState,
  };
}

export async function createScheduleEvent(event: ScheduleEvent, config: AppConfig): Promise<ScheduleEvent> {
  await queueScheduleStoreWrite(async () => {
    const events = await loadScheduleStore(config);
    events.push(event);
    await writeScheduleStore(config, events);
  });
  return event;
}

export async function createScheduleEventWithDefaults(config: AppConfig, draft: ScheduleEventDraft): Promise<ScheduleEvent> {
  const event = buildScheduleEvent(config, draft);
  if (!event.deliveryState && event.status === "active") {
    const occurrence = getCurrentOccurrence(event, new Date());
    if (occurrence) {
      event.deliveryState = {
        currentOccurrence: {
          scheduledAt: occurrence.scheduledAt,
          sentNotificationIds: [],
        },
      };
    }
  }
  return createScheduleEvent(event, config);
}

export async function getScheduleEvent(config: AppConfig, id: string): Promise<ScheduleEvent | null> {
  const events = await readScheduleEvents(config);
  return events.find((item) => item.id === id) || null;
}

export async function updateScheduleEvent(config: AppConfig, event: ScheduleEvent): Promise<void> {
  await queueScheduleStoreWrite(async () => {
    const events = await loadScheduleStore(config);
    const next = events.map((item) => (item.id === event.id ? event : item));
    await writeScheduleStore(config, next);
  });
}

export async function deleteScheduleEvent(config: AppConfig, id: string): Promise<boolean> {
  return queueScheduleStoreWrite(async () => {
    const events = await loadScheduleStore(config);
    let changed = false;
    const next = events.map((item) => {
      if (item.id === id && item.status !== "deleted") {
        changed = true;
        return { ...item, status: "deleted" as const, updatedAt: new Date().toISOString() };
      }
      return item;
    });
    if (changed) await writeScheduleStore(config, next);
    return changed;
  });
}

export async function pruneInactiveScheduleEvents(config: AppConfig): Promise<{ removed: number; removedIds: string[]; removedSummaries: string[] }> {
  return queueScheduleStoreWrite(async () => {
    const events = await loadScheduleStore(config);
    const now = await getAccurateNow();
    const removedIds: string[] = [];
    const removedSummaries: string[] = [];
    const next = events.filter((event) => {
      if (event.status === "deleted") {
        removedIds.push(event.id);
        removedSummaries.push(`${event.title}（${scheduleEventScheduleSummary(config, event)}）`);
        return false;
      }
      if (event.status === "paused" && event.schedule.kind === "once") {
        const scheduledAt = Date.parse(event.schedule.scheduledAt);
        if (Number.isFinite(scheduledAt) && scheduledAt <= now.getTime()) {
          removedIds.push(event.id);
          removedSummaries.push(`${event.title}（${scheduleEventScheduleSummary(config, event)}）`);
          return false;
        }
      }
      return true;
    });
    if (removedIds.length > 0) await writeScheduleStore(config, next);
    return { removed: removedIds.length, removedIds, removedSummaries };
  });
}


