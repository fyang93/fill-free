import type { AppConfig } from "scheduling/app/types";
import { buildReminderScheduleFromExternal } from "./schedule_parser";
import { createReminderEventWithDefaults, deleteReminderEvent, readReminderEvents, resolveReminderTimezone, updateReminderEvent } from ".";
import type { ReminderEvent, ReminderNotification, ReminderTarget } from ".";
import type { TaskRecord } from "support/tasks/runtime/store";
import { enqueueTask } from "support/tasks/runtime/store";

function normalizeDateKey(date: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function extractScheduledDate(event: ReminderEvent): string | undefined {
  if (event.schedule.kind !== "once") return undefined;
  return event.schedule.scheduledAt.slice(0, 10);
}

function extractScheduledAt(event: ReminderEvent): string | undefined {
  if (event.schedule.kind !== "once") return undefined;
  return event.schedule.scheduledAt;
}

function extractLocalScheduledAt(event: ReminderEvent, fallbackTimezone: string): string | undefined {
  if (event.schedule.kind !== "once") return undefined;
  const date = new Date(event.schedule.scheduledAt);
  if (!Number.isFinite(date.getTime())) return undefined;
  const timezone = event.timezone || fallbackTimezone;
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}T${byType.hour}:${byType.minute}:${byType.second}`;
}

function reminderTargetSubject(targets: ReminderTarget[]): TaskRecord["subject"] {
  if (targets.length !== 1) return { kind: "reminder" };
  return {
    kind: targets[0].targetKind,
    id: String(targets[0].targetId),
  };
}

function titleMatches(event: ReminderEvent, match: Record<string, unknown>): boolean {
  const title = event.title.trim().toLowerCase();
  const exact = typeof match.title === "string" && match.title.trim() ? match.title.trim().toLowerCase() : "";
  const contains = typeof match.titleContains === "string" && match.titleContains.trim() ? match.titleContains.trim().toLowerCase() : "";
  if (exact && title !== exact) return false;
  if (contains && !title.includes(contains)) return false;
  return true;
}

async function resolveReminderForUpdate(
  config: AppConfig,
  task: TaskRecord,
  allowedStatuses: ReminderEvent["status"][] = ["active"],
): Promise<ReminderEvent | null> {
  const payload = task.payload;
  const match = payload.match && typeof payload.match === "object" && !Array.isArray(payload.match)
    ? payload.match as Record<string, unknown>
    : {};

  const requesterUserId = task.source?.requesterUserId;
  const events = await readReminderEvents(config);
  const candidates = events.filter((event) => allowedStatuses.includes(event.status)).filter((event) => {
    if (requesterUserId && !event.targets.some((target) => target.targetKind === "user" && target.targetId === requesterUserId)) return false;
    if (!titleMatches(event, match)) return false;
    const scheduledDate = typeof match.scheduledDate === "string" && match.scheduledDate.trim() ? match.scheduledDate.trim() : undefined;
    if (scheduledDate && extractScheduledDate(event) !== scheduledDate) return false;
    const scheduledAt = typeof match.scheduledAt === "string" && match.scheduledAt.trim() ? match.scheduledAt.trim() : undefined;
    if (scheduledAt) {
      const normalizedScheduledAt = scheduledAt.replace(/\.000Z$/, "").replace(/Z$/, "");
      const eventScheduledAt = extractScheduledAt(event)?.replace(/\.000Z$/, "").replace(/Z$/, "");
      const localScheduledAt = extractLocalScheduledAt(event, config.bot.defaultTimezone);
      if (eventScheduledAt !== normalizedScheduledAt && localScheduledAt !== normalizedScheduledAt) return false;
    }
    if (match.timeframe === "tomorrow") {
      const timezone = event.timezone || config.bot.defaultTimezone;
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      if (extractScheduledDate(event) !== normalizeDateKey(tomorrow, timezone)) return false;
    }
    return true;
  });

  if (candidates.length === 1) return candidates[0];
  return null;
}

export async function enqueueReminderCreateTask(
  config: AppConfig,
  input: {
    title: string;
    note?: string;
    schedule: Record<string, unknown>;
    category?: string;
    specialKind?: string;
    timeSemantics?: string;
    timezone?: string;
    notifications?: ReminderNotification[];
    targets: ReminderTarget[];
  },
  source?: TaskRecord["source"],
): Promise<TaskRecord> {
  const dateKey = typeof input.schedule.scheduledAt === "string" && input.schedule.scheduledAt.trim()
    ? input.schedule.scheduledAt.slice(0, 10)
    : typeof input.schedule.date === "string" && input.schedule.date.trim()
      ? input.schedule.date.trim()
      : "floating";
  return enqueueTask(config, {
    domain: "reminders",
    operation: "create",
    subject: reminderTargetSubject(input.targets),
    payload: {
      title: input.title,
      note: input.note,
      schedule: input.schedule,
      category: input.category,
      specialKind: input.specialKind,
      timeSemantics: input.timeSemantics,
      timezone: input.timezone,
      notifications: input.notifications,
      targets: input.targets,
    },
    dedupeKey: `reminders:create:${input.targets.map((target) => `${target.targetKind}:${target.targetId}`).join(",")}:${input.title}:${dateKey}`,
    source,
  });
}

export async function enqueueReminderPreparationTask(
  config: AppConfig,
  reminderId: string,
  source?: TaskRecord["source"],
  supersedesTaskIds?: string[],
): Promise<TaskRecord> {
  return enqueueTask(config, {
    domain: "reminders",
    operation: "prepare-delivery-text",
    subject: { kind: "reminder", id: reminderId },
    payload: { reminderId },
    dedupeKey: `reminders:prepare-delivery-text:${reminderId}`,
    supersedesTaskIds,
    source,
  });
}

export async function runReminderTask(config: AppConfig, task: TaskRecord): Promise<{ changed?: boolean; reminderId?: string; skipped?: boolean; reason?: string }> {
  if (task.operation === "create") {
    const payload = task.payload;
    const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "";
    const schedule = payload.schedule && typeof payload.schedule === "object" && !Array.isArray(payload.schedule)
      ? payload.schedule as Record<string, unknown>
      : null;
    const targets = Array.isArray(payload.targets)
      ? payload.targets.filter((target): target is ReminderTarget => Boolean(target) && typeof target === "object" && ((target as ReminderTarget).targetKind === "user" || (target as ReminderTarget).targetKind === "chat") && Number.isInteger((target as ReminderTarget).targetId))
      : [];
    const notifications = Array.isArray(payload.notifications)
      ? payload.notifications.filter((item): item is ReminderNotification => Boolean(item) && typeof item === "object" && typeof (item as ReminderNotification).id === "string" && Number.isInteger((item as ReminderNotification).offsetMinutes))
      : undefined;
    if (!title || !schedule || targets.length === 0) return { skipped: true, reason: "invalid-create-payload" };
    const specialKind = payload.specialKind === "birthday" || payload.specialKind === "festival" || payload.specialKind === "anniversary" || payload.specialKind === "memorial"
      ? payload.specialKind
      : undefined;
    const event = await createReminderEventWithDefaults(config, {
      title,
      note: typeof payload.note === "string" ? payload.note.trim() || undefined : undefined,
      schedule: buildReminderScheduleFromExternal(schedule),
      category: payload.category === "special" || specialKind ? "special" : payload.category === "routine" ? "routine" : undefined,
      specialKind,
      timeSemantics: payload.timeSemantics === "absolute" || payload.timeSemantics === "local" ? payload.timeSemantics : undefined,
      timezone: typeof payload.timezone === "string" && payload.timezone.trim() ? payload.timezone.trim() : resolveReminderTimezone(config, { userId: task.source?.requesterUserId }),
      notifications,
      targets,
    });
    await enqueueReminderPreparationTask(config, event.id, task.source, [task.id]);
    return { changed: true, reminderId: event.id };
  }

  if (task.operation === "update") {
    const event = await resolveReminderForUpdate(config, task);
    if (!event) return { skipped: true, reason: "reminder-not-resolved" };
    const changes = task.payload.changes && typeof task.payload.changes === "object" && !Array.isArray(task.payload.changes)
      ? task.payload.changes as Record<string, unknown>
      : {};

    if (typeof changes.title === "string" && changes.title.trim()) event.title = changes.title.trim();
    if (typeof changes.note === "string") event.note = changes.note.trim() || undefined;
    if (typeof changes.timezone === "string" && changes.timezone.trim()) event.timezone = changes.timezone.trim();
    if (changes.timeSemantics === "absolute" || changes.timeSemantics === "local") event.timeSemantics = changes.timeSemantics;
    if (changes.schedule && typeof changes.schedule === "object" && !Array.isArray(changes.schedule)) {
      event.schedule = buildReminderScheduleFromExternal(changes.schedule as Record<string, unknown>);
      if (!event.timezone) {
        event.timezone = resolveReminderTimezone(config, { userId: task.source?.requesterUserId });
      }
    }
    event.updatedAt = new Date().toISOString();
    await updateReminderEvent(config, event);
    await enqueueReminderPreparationTask(config, event.id, task.source, [task.id]);
    return { changed: true, reminderId: event.id };
  }

  if (task.operation === "delete") {
    const event = await resolveReminderForUpdate(config, task, ["active"]);
    if (!event) return { skipped: true, reason: "reminder-not-resolved" };
    const changed = await deleteReminderEvent(config, event.id);
    return { changed, reminderId: event.id };
  }

  if (task.operation === "pause") {
    const event = await resolveReminderForUpdate(config, task, ["active"]);
    if (!event) return { skipped: true, reason: "reminder-not-resolved" };
    event.status = "paused";
    event.updatedAt = new Date().toISOString();
    event.deliveryText = undefined;
    event.deliveryTextGeneratedAt = undefined;
    event.deliveryPreparedNotificationId = undefined;
    event.deliveryPreparedNotifyAt = undefined;
    await updateReminderEvent(config, event);
    return { changed: true, reminderId: event.id };
  }

  if (task.operation === "resume") {
    const event = await resolveReminderForUpdate(config, task, ["paused"]);
    if (!event) return { skipped: true, reason: "reminder-not-resolved" };
    event.status = "active";
    event.updatedAt = new Date().toISOString();
    event.deliveryText = undefined;
    event.deliveryTextGeneratedAt = undefined;
    event.deliveryPreparedNotificationId = undefined;
    event.deliveryPreparedNotifyAt = undefined;
    event.deliveryState = undefined;
    await updateReminderEvent(config, event);
    await enqueueReminderPreparationTask(config, event.id, task.source, [task.id]);
    return { changed: true, reminderId: event.id };
  }

  return { skipped: true, reason: "unsupported-reminder-operation" };
}
