import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppConfig } from "../types";
import { getAccurateNow } from "../time";
import { getUserTimezone } from "../state";
import type { Reminder, ReminderEvent, ReminderEventKind, ReminderNotification, ReminderSchedule, ReminderStoreV2, ReminderTimeSemantics } from "./types";

export type ReminderEventDraft = {
  title: string;
  note?: string;
  schedule: ReminderSchedule;
  category?: "routine" | "special";
  specialKind?: Reminder["specialKind"];
  kind?: ReminderEventKind;
  timeSemantics?: ReminderTimeSemantics;
  timezone?: string;
  notifications?: ReminderNotification[];
  status?: ReminderEvent["status"];
  createdAt?: string;
  updatedAt?: string;
  ownerUserId?: number;
  targetUserId?: number;
  targetDisplayName?: string;
  deliveryText?: string;
  deliveryTextGeneratedAt?: string;
  deliveryPreparedNotificationId?: string;
  deliveryPreparedNotifyAt?: string;
  deliveryState?: ReminderEvent["deliveryState"];
};
import { nextLunarYearlyOccurrence, normalizeRecurrence, normalizeScheduledAt } from "./schedule";

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

export function defaultReminderEventKind(input: { category?: "routine" | "special"; specialKind?: Reminder["specialKind"]; kind?: ReminderEventKind; schedule?: ReminderSchedule }): ReminderEventKind {
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
  return path.join(config.paths.repoRoot, "memory", "reminders.json");
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
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const kind = typeof record.kind === "string" ? record.kind : "";
  if (kind === "once") {
    const scheduledAt = typeof record.scheduledAt === "string" ? normalizeScheduledAt(record.scheduledAt) : "";
    return scheduledAt ? { kind, scheduledAt } : null;
  }
  if (kind === "interval") {
    const recurrence = normalizeRecurrence(record);
    if (recurrence.kind !== "interval") return null;
    const anchorAt = typeof record.anchorAt === "string" ? normalizeScheduledAt(record.anchorAt) : "";
    return anchorAt ? { kind, unit: recurrence.unit, every: recurrence.every, anchorAt } : null;
  }
  if (kind === "weekly") {
    const recurrence = normalizeRecurrence(record);
    const hour = Number(record.time && typeof record.time === "object" ? (record.time as Record<string, unknown>).hour : NaN);
    const minute = Number(record.time && typeof record.time === "object" ? (record.time as Record<string, unknown>).minute : NaN);
    if (recurrence.kind !== "weekly" || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    const anchorDate = typeof record.anchorDate === "string" && record.anchorDate.trim() ? record.anchorDate.trim() : undefined;
    return { kind, every: recurrence.every, daysOfWeek: recurrence.daysOfWeek, time: { hour, minute }, anchorDate };
  }
  if (kind === "monthly") {
    const recurrence = normalizeRecurrence(record);
    const hour = Number(record.time && typeof record.time === "object" ? (record.time as Record<string, unknown>).hour : NaN);
    const minute = Number(record.time && typeof record.time === "object" ? (record.time as Record<string, unknown>).minute : NaN);
    if (recurrence.kind !== "monthly" || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    const anchorDate = typeof record.anchorDate === "string" && record.anchorDate.trim() ? record.anchorDate.trim() : undefined;
    if (recurrence.mode === "dayOfMonth") return { kind, every: recurrence.every, mode: recurrence.mode, dayOfMonth: recurrence.dayOfMonth, time: { hour, minute }, anchorDate };
    return { kind, every: recurrence.every, mode: recurrence.mode, weekOfMonth: recurrence.weekOfMonth, dayOfWeek: recurrence.dayOfWeek, time: { hour, minute }, anchorDate };
  }
  if (kind === "yearly") {
    const recurrence = normalizeRecurrence(record);
    const hour = Number(record.time && typeof record.time === "object" ? (record.time as Record<string, unknown>).hour : NaN);
    const minute = Number(record.time && typeof record.time === "object" ? (record.time as Record<string, unknown>).minute : NaN);
    if (recurrence.kind !== "yearly" || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    return { kind, every: recurrence.every, month: recurrence.month, day: recurrence.day, time: { hour, minute } };
  }
  if (kind === "lunarYearly") {
    const recurrence = normalizeRecurrence(record);
    const hour = Number(record.time && typeof record.time === "object" ? (record.time as Record<string, unknown>).hour : NaN);
    const minute = Number(record.time && typeof record.time === "object" ? (record.time as Record<string, unknown>).minute : NaN);
    if (recurrence.kind !== "lunarYearly" || !Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    return {
      kind,
      month: recurrence.month,
      day: recurrence.day,
      isLeapMonth: recurrence.isLeapMonth,
      leapMonthPolicy: recurrence.leapMonthPolicy,
      time: { hour, minute },
    };
  }
  return null;
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
  const ownerUserId = typeof record.ownerUserId === "number" && Number.isInteger(record.ownerUserId) ? record.ownerUserId : undefined;
  const targetUserId = typeof record.targetUserId === "number" && Number.isInteger(record.targetUserId) ? record.targetUserId : undefined;
  const targetDisplayName = typeof record.targetDisplayName === "string" && record.targetDisplayName.trim() ? record.targetDisplayName.trim() : undefined;
  const deliveryText = typeof record.deliveryText === "string" && record.deliveryText.trim() ? record.deliveryText.trim() : undefined;
  const deliveryTextGeneratedAt = typeof record.deliveryTextGeneratedAt === "string" && record.deliveryTextGeneratedAt.trim() ? record.deliveryTextGeneratedAt.trim() : undefined;
  const deliveryPreparedNotificationId = typeof record.deliveryPreparedNotificationId === "string" && record.deliveryPreparedNotificationId.trim() ? record.deliveryPreparedNotificationId.trim() : undefined;
  const deliveryPreparedNotifyAt = typeof record.deliveryPreparedNotifyAt === "string" && record.deliveryPreparedNotifyAt.trim() ? record.deliveryPreparedNotifyAt.trim() : undefined;
  const deliveryState = record.deliveryState && typeof record.deliveryState === "object" ? record.deliveryState as ReminderEvent["deliveryState"] : undefined;
  if (!id || !title || !schedule || !createdAt || notifications.length === 0) return null;
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
    ownerUserId,
    targetUserId,
    targetDisplayName,
    deliveryText,
    deliveryTextGeneratedAt,
    deliveryPreparedNotificationId,
    deliveryPreparedNotifyAt,
    deliveryState,
  };
}

function legacyReminderToEvent(reminder: Reminder): ReminderEvent {
  const recurring = normalizeRecurrence(reminder.recurrence);
  const scheduledAt = normalizeScheduledAt(reminder.scheduledAt);
  const date = new Date(scheduledAt);
  let schedule: ReminderSchedule;

  if (recurring.kind === "once") {
    schedule = { kind: "once", scheduledAt };
  } else if (recurring.kind === "interval") {
    schedule = { kind: "interval", unit: recurring.unit, every: recurring.every, anchorAt: scheduledAt };
  } else if (recurring.kind === "weekly") {
    schedule = { kind: "weekly", every: recurring.every, daysOfWeek: recurring.daysOfWeek, time: { hour: date.getHours(), minute: date.getMinutes() } };
  } else if (recurring.kind === "monthly") {
    if (recurring.mode === "dayOfMonth") {
      schedule = { kind: "monthly", every: recurring.every, mode: recurring.mode, dayOfMonth: recurring.dayOfMonth, time: { hour: date.getHours(), minute: date.getMinutes() } };
    } else {
      schedule = { kind: "monthly", every: recurring.every, mode: recurring.mode, weekOfMonth: recurring.weekOfMonth, dayOfWeek: recurring.dayOfWeek, time: { hour: date.getHours(), minute: date.getMinutes() } };
    }
  } else if (recurring.kind === "yearly") {
    schedule = { kind: "yearly", every: recurring.every, month: recurring.month, day: recurring.day, time: { hour: date.getHours(), minute: date.getMinutes() } };
  } else {
    schedule = {
      kind: "lunarYearly",
      month: recurring.month,
      day: recurring.day,
      isLeapMonth: recurring.isLeapMonth,
      leapMonthPolicy: recurring.leapMonthPolicy,
      time: { hour: date.getHours(), minute: date.getMinutes() },
    };
  }

  const kind = defaultReminderEventKind({ category: reminder.category, specialKind: reminder.specialKind, schedule });
  return {
    id: reminder.id,
    title: reminder.text,
    kind,
    timeSemantics: defaultReminderTimeSemantics(kind, schedule),
    timezone: DEFAULT_TIMEZONE,
    schedule,
    notifications: buildDefaultReminderNotifications(kind),
    category: reminder.category,
    specialKind: reminder.specialKind,
    status: reminder.status === "deleted" ? "deleted" : reminder.status === "sent" ? "paused" : "active",
    createdAt: reminder.createdAt,
    updatedAt: reminder.sentAt,
    ownerUserId: reminder.ownerUserId,
  };
}

function eventToLegacyReminder(event: ReminderEvent): Reminder | null {
  const activeNotification = event.notifications.find((item) => item.enabled && item.offsetMinutes === 0) || event.notifications.find((item) => item.enabled);
  if (!activeNotification) return null;

  let scheduledAt = "";
  let recurrence: Reminder["recurrence"];
  const schedule = event.schedule;
  if (schedule.kind === "once") {
    scheduledAt = schedule.scheduledAt;
    recurrence = { kind: "once" };
  } else if (schedule.kind === "interval") {
    scheduledAt = schedule.anchorAt;
    recurrence = { kind: "interval", unit: schedule.unit, every: schedule.every };
  } else if (schedule.kind === "weekly") {
    const anchor = schedule.anchorDate ? new Date(schedule.anchorDate) : new Date();
    anchor.setHours(schedule.time.hour, schedule.time.minute, 0, 0);
    scheduledAt = anchor.toISOString();
    recurrence = { kind: "weekly", every: schedule.every, daysOfWeek: schedule.daysOfWeek };
  } else if (schedule.kind === "monthly") {
    const anchor = schedule.anchorDate ? new Date(schedule.anchorDate) : new Date();
    anchor.setHours(schedule.time.hour, schedule.time.minute, 0, 0);
    scheduledAt = anchor.toISOString();
    recurrence = schedule.mode === "dayOfMonth"
      ? { kind: "monthly", every: schedule.every, mode: schedule.mode, dayOfMonth: schedule.dayOfMonth }
      : { kind: "monthly", every: schedule.every, mode: schedule.mode, weekOfMonth: schedule.weekOfMonth, dayOfWeek: schedule.dayOfWeek };
  } else if (schedule.kind === "yearly") {
    const base = new Date();
    base.setMonth(schedule.month - 1, schedule.day);
    base.setHours(schedule.time.hour, schedule.time.minute, 0, 0);
    scheduledAt = base.toISOString();
    recurrence = { kind: "yearly", every: schedule.every, month: schedule.month, day: schedule.day };
  } else {
    const base = new Date();
    base.setHours(schedule.time.hour, schedule.time.minute, 0, 0);
    scheduledAt = base.toISOString();
    recurrence = { kind: "lunarYearly", month: schedule.month, day: schedule.day, isLeapMonth: schedule.isLeapMonth, leapMonthPolicy: schedule.leapMonthPolicy };
  }

  return {
    id: event.id,
    text: event.title,
    scheduledAt,
    recurrence,
    category: event.category,
    specialKind: event.specialKind,
    status: event.status === "deleted" ? "deleted" : event.status === "paused" ? "sent" : "pending",
    createdAt: event.createdAt,
    sentAt: event.updatedAt,
    ownerUserId: event.ownerUserId,
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

export async function readReminderEvents(config: AppConfig): Promise<ReminderEvent[]> {
  return loadReminderStore(config);
}

export async function writeReminderEvents(config: AppConfig, events: ReminderEvent[]): Promise<void> {
  await writeReminderStore(config, events);
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
    ownerUserId: draft.ownerUserId,
    targetUserId: draft.targetUserId,
    targetDisplayName: draft.targetDisplayName,
    deliveryText: draft.deliveryText,
    deliveryTextGeneratedAt: draft.deliveryTextGeneratedAt,
    deliveryPreparedNotificationId: draft.deliveryPreparedNotificationId,
    deliveryPreparedNotifyAt: draft.deliveryPreparedNotifyAt,
    deliveryState: draft.deliveryState,
  };
}

export async function createReminderEvent(event: ReminderEvent, config: AppConfig): Promise<ReminderEvent> {
  const events = await readReminderEvents(config);
  events.push(event);
  await writeReminderEvents(config, events);
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
  const events = await readReminderEvents(config);
  const next = events.map((item) => (item.id === event.id ? event : item));
  await writeReminderEvents(config, next);
}

export async function deleteReminderEvent(config: AppConfig, id: string): Promise<boolean> {
  const events = await readReminderEvents(config);
  let changed = false;
  const next = events.map((item) => {
    if (item.id === id && item.status !== "deleted") {
      changed = true;
      return { ...item, status: "deleted" as const, updatedAt: new Date().toISOString() };
    }
    return item;
  });
  if (changed) await writeReminderEvents(config, next);
  return changed;
}

export async function pruneInactiveReminderEvents(config: AppConfig): Promise<{ removed: number; removedIds: string[] }> {
  const events = await readReminderEvents(config);
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
  if (removedIds.length > 0) await writeReminderEvents(config, next);
  return { removed: removedIds.length, removedIds };
}

export async function pruneExpiredReminderEvents(config: AppConfig): Promise<{ removed: number; removedIds: string[] }> {
  const events = await readReminderEvents(config);
  const now = await getAccurateNow();
  const removedIds: string[] = [];
  const next = events.filter((event) => {
    if (event.schedule.kind !== "once") return true;
    const scheduledAt = Date.parse(event.schedule.scheduledAt);
    if (!Number.isFinite(scheduledAt) || scheduledAt > now.getTime()) return true;
    removedIds.push(event.id);
    return false;
  });
  if (removedIds.length > 0) await writeReminderEvents(config, next);
  return { removed: removedIds.length, removedIds };
}

// Temporary legacy wrappers while schedule/ui/delivery are still on the old reminder model.
export async function readReminders(config: AppConfig): Promise<Reminder[]> {
  const events = await readReminderEvents(config);
  return events.map(eventToLegacyReminder).filter((item): item is Reminder => Boolean(item));
}

export async function writeReminders(config: AppConfig, reminders: Reminder[]): Promise<void> {
  const currentEvents = await readReminderEvents(config);
  const eventMap = new Map(currentEvents.map((event) => [event.id, event]));
  const nextEvents = reminders.map((reminder) => eventMap.get(reminder.id) ?? legacyReminderToEvent(reminder));
  await writeReminderEvents(config, nextEvents);
}

export async function createReminder(
  config: AppConfig,
  text: string,
  scheduledAt: string,
  recurrence?: unknown,
  metadata?: {
    category?: "routine" | "special";
    specialKind?: Reminder["specialKind"];
    kind?: ReminderEventKind;
    timeSemantics?: ReminderTimeSemantics;
    timezone?: string;
    ownerUserId?: number;
    targetUserId?: number;
    targetDisplayName?: string;
    notifications?: ReminderNotification[];
  },
): Promise<Reminder> {
  const normalizedRecurrence = normalizeRecurrence(recurrence);
  const now = await getAccurateNow();
  let normalizedScheduledAt = normalizeScheduledAt(scheduledAt);
  if (normalizedRecurrence.kind === "lunarYearly") {
    normalizedScheduledAt = nextLunarYearlyOccurrence(normalizedScheduledAt, new Date(now.getTime() - 1000), normalizedRecurrence);
  }
  const reminder: Reminder = {
    id: `rmd_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text,
    scheduledAt: normalizedScheduledAt,
    recurrence: normalizedRecurrence,
    category: metadata?.category || "routine",
    specialKind: metadata?.specialKind,
    status: "pending",
    createdAt: now.toISOString(),
  };
  const baseEvent = legacyReminderToEvent(reminder);
  const event = buildReminderEvent({
    title: baseEvent.title,
    note: baseEvent.note,
    schedule: baseEvent.schedule,
    category: reminder.category,
    specialKind: reminder.specialKind,
    kind: metadata?.kind,
    timeSemantics: metadata?.timeSemantics,
    timezone: metadata?.timezone || baseEvent.timezone,
    notifications: metadata?.notifications,
    createdAt: reminder.createdAt,
    updatedAt: reminder.sentAt,
    ownerUserId: metadata?.ownerUserId ?? reminder.ownerUserId,
    targetUserId: metadata?.targetUserId,
    targetDisplayName: metadata?.targetDisplayName,
    status: baseEvent.status,
  });
  event.id = reminder.id;
  await createReminderEvent(event, config);
  return reminder;
}

export async function listPendingReminders(config: AppConfig): Promise<Reminder[]> {
  const reminders = await readReminders(config);
  return reminders.filter((item) => item.status === "pending").sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
}

export async function getReminder(config: AppConfig, id: string): Promise<Reminder | null> {
  const reminders = await readReminders(config);
  return reminders.find((item) => item.id === id) || null;
}

export async function deleteReminder(config: AppConfig, id: string): Promise<boolean> {
  return deleteReminderEvent(config, id);
}
