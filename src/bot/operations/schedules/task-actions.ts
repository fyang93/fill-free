import type { AppConfig } from "bot/app/types";
import { canRequesterCreateScheduleTargets } from "bot/operations/access/control";
import { buildScheduleScheduleFromExternal } from "./schedule_parser";
import { buildScheduledTaskPrompt } from "./scheduled-task";
import { createScheduleEventWithDefaults, deleteScheduleEvent, getCurrentOccurrence, readScheduleEvents, resolveScheduleTimezone, shouldGenerateScheduledTaskOnDelivery, updateScheduleEvent } from ".";
import type { ScheduleEvent, ScheduleNotification, ScheduleTarget } from ".";
import type { TaskRecord } from "bot/tasks/runtime/store";
import { enqueueTask } from "bot/tasks/runtime/store";

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

function extractScheduledDate(event: ScheduleEvent): string | undefined {
  if (event.schedule.kind !== "once") return undefined;
  return event.schedule.scheduledAt.slice(0, 10);
}

function extractScheduledAt(event: ScheduleEvent): string | undefined {
  if (event.schedule.kind !== "once") return undefined;
  return event.schedule.scheduledAt;
}

function extractLocalScheduledAt(event: ScheduleEvent, fallbackTimezone: string): string | undefined {
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

function scheduleTargetSubject(targets: ScheduleTarget[]): TaskRecord["subject"] {
  if (targets.length !== 1) return { kind: "schedule" };
  return {
    kind: targets[0].targetKind,
    id: String(targets[0].targetId),
  };
}

function normalizeScheduleTargets(raw: unknown): ScheduleTarget[] {
  return Array.isArray(raw)
    ? raw.filter((target): target is ScheduleTarget => Boolean(target) && typeof target === "object" && ((target as ScheduleTarget).targetKind === "user" || (target as ScheduleTarget).targetKind === "chat") && Number.isInteger((target as ScheduleTarget).targetId))
    : [];
}

function scheduleTargetsFromPayload(task: TaskRecord): ScheduleTarget[] {
  const payloadTargets = normalizeScheduleTargets(task.payload.targets);
  if (payloadTargets.length > 0) return payloadTargets;
  if (Number.isInteger(task.source?.requesterUserId)) {
    return [{ targetKind: "user", targetId: Number(task.source?.requesterUserId) }];
  }
  if (Number.isInteger(task.source?.chatId)) {
    return [{ targetKind: "chat", targetId: Number(task.source?.chatId) }];
  }
  return [];
}

function scheduleTargetsFromUpdateChanges(changes: Record<string, unknown>): ScheduleTarget[] | undefined {
  const explicitTargets = normalizeScheduleTargets(changes.targets);
  if (explicitTargets.length > 0) return explicitTargets;
  const targetUserId = Number.isInteger(changes.targetUserId) ? Number(changes.targetUserId) : undefined;
  if (typeof targetUserId === "number") {
    return [{ targetKind: "user", targetId: targetUserId }];
  }
  const targetChatId = Number.isInteger(changes.targetChatId) ? Number(changes.targetChatId) : undefined;
  if (typeof targetChatId === "number") {
    return [{ targetKind: "chat", targetId: targetChatId }];
  }
  return undefined;
}

function titleMatches(event: ScheduleEvent, match: Record<string, unknown>): boolean {
  const title = event.title.trim().toLowerCase();
  const exact = typeof match.title === "string" && match.title.trim() ? match.title.trim().toLowerCase() : "";
  const contains = typeof match.titleContains === "string" && match.titleContains.trim() ? match.titleContains.trim().toLowerCase() : "";
  if (exact && title !== exact) return false;
  if (contains && !title.includes(contains)) return false;
  return true;
}

function idMatches(event: ScheduleEvent, match: Record<string, unknown>): boolean {
  const id = typeof match.id === "string" && match.id.trim() ? match.id.trim() : "";
  const scheduleId = typeof match.scheduleId === "string" && match.scheduleId.trim() ? match.scheduleId.trim() : "";
  if (id && event.id !== id) return false;
  if (scheduleId && event.id !== scheduleId) return false;
  return true;
}

function explicitScheduleIds(match: Record<string, unknown>): string[] {
  const raw = Array.isArray(match.scheduleIds)
    ? match.scheduleIds
    : Array.isArray(match.ids)
      ? match.ids
      : [];
  return raw.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
}

function scheduleMatchesFilters(event: ScheduleEvent, match: Record<string, unknown>, defaultTimezone: string): boolean {
  if (!idMatches(event, match)) return false;
  if (!titleMatches(event, match)) return false;
  const scheduledDate = typeof match.scheduledDate === "string" && match.scheduledDate.trim() ? match.scheduledDate.trim() : undefined;
  if (scheduledDate && extractScheduledDate(event) !== scheduledDate) return false;
  const scheduledAt = typeof match.scheduledAt === "string" && match.scheduledAt.trim() ? match.scheduledAt.trim() : undefined;
  if (scheduledAt) {
    const normalizedScheduledAt = scheduledAt.replace(/\.000Z$/, "").replace(/Z$/, "");
    const eventScheduledAt = extractScheduledAt(event)?.replace(/\.000Z$/, "").replace(/Z$/, "");
    const localScheduledAt = extractLocalScheduledAt(event, defaultTimezone);
    if (eventScheduledAt !== normalizedScheduledAt && localScheduledAt !== normalizedScheduledAt) return false;
  }
  if (match.timeframe === "tomorrow") {
    const timezone = event.timezone || defaultTimezone;
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    if (extractScheduledDate(event) !== normalizeDateKey(tomorrow, timezone)) return false;
  }
  return true;
}

async function resolveSchedulesForMutation(
  config: AppConfig,
  task: TaskRecord,
  allowedStatuses: ScheduleEvent["status"][] = ["active"],
): Promise<{ mode: "single" | "batch"; events: ScheduleEvent[]; reason?: string }> {
  const payload = task.payload;
  const match = payload.match && typeof payload.match === "object" && !Array.isArray(payload.match)
    ? payload.match as Record<string, unknown>
    : {};

  const requesterUserId = task.source?.requesterUserId;
  const events = (await readScheduleEvents(config)).filter((event) => allowedStatuses.includes(event.status)).filter((event) => {
    if (requesterUserId && !event.targets.some((target) => target.targetKind === "user" && target.targetId === requesterUserId)) return false;
    return scheduleMatchesFilters(event, match, config.bot.defaultTimezone);
  });

  const batchIds = explicitScheduleIds(match);
  if (batchIds.length > 0) {
    const allEvents = (await readScheduleEvents(config)).filter((event) => allowedStatuses.includes(event.status));
    const byId = new Map(allEvents.map((event) => [event.id, event]));
    const resolved = batchIds.map((id) => byId.get(id)).filter((event): event is ScheduleEvent => Boolean(event));
    if (resolved.length !== batchIds.length) return { mode: "batch", events: [], reason: "schedule-batch-not-resolved" };
    return { mode: "batch", events: resolved };
  }

  if (events.length === 1) return { mode: "single", events: [events[0]] };
  return { mode: "single", events: [], reason: "schedule-not-resolved" };
}

export async function enqueueScheduleCreateTask(
  config: AppConfig,
  input: {
    title: string;
    note?: string;
    schedule: Record<string, unknown>;
    category?: string;
    specialKind?: string;
    timeSemantics?: string;
    timezone?: string;
    notifications?: ScheduleNotification[];
    targets: ScheduleTarget[];
  },
  source?: TaskRecord["source"],
): Promise<TaskRecord> {
  const dateKey = typeof input.schedule.scheduledAt === "string" && input.schedule.scheduledAt.trim()
    ? input.schedule.scheduledAt.slice(0, 10)
    : typeof input.schedule.date === "string" && input.schedule.date.trim()
      ? input.schedule.date.trim()
      : "floating";
  return enqueueTask(config, {
    domain: "schedules",
    operation: "create",
    subject: scheduleTargetSubject(input.targets),
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
    dedupeKey: `schedules:create:${input.targets.map((target) => `${target.targetKind}:${target.targetId}`).join(",")}:${input.title}:${dateKey}`,
    source,
  });
}

export async function enqueueSchedulePreparationTask(
  config: AppConfig,
  scheduleId: string,
  source?: TaskRecord["source"],
  supersedesTaskIds?: string[],
): Promise<TaskRecord> {
  return enqueueTask(config, {
    domain: "schedules",
    operation: "prepare-delivery-text",
    subject: { kind: "schedule", id: scheduleId },
    payload: { scheduleId },
    dedupeKey: `schedules:prepare-delivery-text:${scheduleId}`,
    supersedesTaskIds,
    source,
  });
}

export async function runScheduleTask(config: AppConfig, task: TaskRecord): Promise<{ changed?: boolean; scheduleId?: string; scheduleIds?: string[]; skipped?: boolean; reason?: string }> {
  if (task.operation === "create") {
    const payload = task.payload;
    const title = typeof payload.title === "string" && payload.title.trim() ? payload.title.trim() : "";
    const schedule = payload.schedule && typeof payload.schedule === "object" && !Array.isArray(payload.schedule)
      ? payload.schedule as Record<string, unknown>
      : null;
    const targets = scheduleTargetsFromPayload(task);
    const notifications = Array.isArray(payload.notifications)
      ? payload.notifications.filter((item): item is ScheduleNotification => Boolean(item) && typeof item === "object" && typeof (item as ScheduleNotification).id === "string" && Number.isInteger((item as ScheduleNotification).offsetMinutes))
      : undefined;
    if (!title || !schedule || targets.length === 0) return { skipped: true, reason: "invalid-create-payload" };
    if (!canRequesterCreateScheduleTargets(config, task.source?.requesterUserId, targets)) return { skipped: true, reason: "schedule-create-not-allowed" };
    const specialKind = payload.specialKind === "birthday" || payload.specialKind === "festival" || payload.specialKind === "anniversary" || payload.specialKind === "memorial"
      ? payload.specialKind
      : undefined;
    const category = payload.specialKind === "scheduled-task" || payload.timeSemantics === "scheduled-task"
      ? "scheduled-task"
      : payload.category === "scheduled-task"
        ? "scheduled-task"
        : payload.category === "special" || specialKind
          ? "special"
          : payload.category === "routine"
            ? "routine"
            : undefined;
    const resolvedTimezone = typeof payload.timezone === "string" && payload.timezone.trim()
      ? payload.timezone.trim()
      : resolveScheduleTimezone(config, { userId: task.source?.requesterUserId, recipientUserId: task.source?.requesterUserId, timeSemantics: payload.timeSemantics === "absolute" || payload.timeSemantics === "local" ? payload.timeSemantics : undefined });
    const event = await createScheduleEventWithDefaults(config, {
      title,
      note: typeof payload.note === "string" ? payload.note.trim() || undefined : undefined,
      schedule: buildScheduleScheduleFromExternal(schedule, resolvedTimezone),
      category,
      specialKind,
      timeSemantics: payload.timeSemantics === "absolute" || payload.timeSemantics === "local" ? payload.timeSemantics : undefined,
      timezone: resolvedTimezone,
      notifications,
      targets,
    });
    if (!shouldGenerateScheduledTaskOnDelivery(event)) {
      await enqueueSchedulePreparationTask(config, event.id, task.source, [task.id]);
    }
    return { changed: true, scheduleId: event.id };
  }

  if (task.operation === "upsert") {
    const payload = task.payload;
    const hasMatch = Boolean(payload.match && typeof payload.match === "object" && !Array.isArray(payload.match));
    const hasChanges = Boolean(payload.changes && typeof payload.changes === "object" && !Array.isArray(payload.changes));
    if (hasMatch || hasChanges) {
      return runScheduleTask(config, { ...task, operation: "update" });
    }
    return runScheduleTask(config, { ...task, operation: "create" });
  }

  if (task.operation === "update") {
    const resolved = await resolveSchedulesForMutation(config, task);
    if (resolved.events.length === 0) return { skipped: true, reason: resolved.reason || "schedule-not-resolved" };
    const changes = task.payload.changes && typeof task.payload.changes === "object" && !Array.isArray(task.payload.changes)
      ? task.payload.changes as Record<string, unknown>
      : {};

    const changedIds: string[] = [];
    for (const event of resolved.events) {
      if (typeof changes.title === "string" && changes.title.trim()) event.title = changes.title.trim();
      if (typeof changes.note === "string") event.note = changes.note.trim() || undefined;

      const timezoneChanged = typeof changes.timezone === "string" && changes.timezone.trim().length > 0;
      if (timezoneChanged) event.timezone = changes.timezone.trim();

      const timeSemanticsChanged = changes.timeSemantics === "absolute" || changes.timeSemantics === "local";
      if (timeSemanticsChanged) event.timeSemantics = changes.timeSemantics;

      const categoryChanged = changes.category === "routine" || changes.category === "special" || changes.category === "scheduled-task";
      if (categoryChanged) event.category = changes.category;

      const specialKindChanged = changes.specialKind === "birthday" || changes.specialKind === "festival" || changes.specialKind === "anniversary" || changes.specialKind === "memorial";
      if (specialKindChanged) event.specialKind = changes.specialKind;
      else if (changes.specialKind === null) event.specialKind = undefined;

      const notificationsChanged = Array.isArray(changes.notifications);
      if (notificationsChanged) {
        event.notifications = changes.notifications.filter((item): item is ScheduleNotification => Boolean(item) && typeof item === "object" && typeof (item as ScheduleNotification).id === "string" && Number.isInteger((item as ScheduleNotification).offsetMinutes));
      }

      if (event.specialKind && event.category !== "special") {
        event.category = "special";
      }

      const updatedTargets = scheduleTargetsFromUpdateChanges(changes);
      if (updatedTargets && updatedTargets.length > 0) event.targets = updatedTargets;

      const scheduleChanged = Boolean(changes.schedule && typeof changes.schedule === "object" && !Array.isArray(changes.schedule));
      if (scheduleChanged) {
        const resolvedTimezone = (typeof changes.timezone === "string" && changes.timezone.trim()) || event.timezone || resolveScheduleTimezone(config, { userId: task.source?.requesterUserId });
        event.schedule = buildScheduleScheduleFromExternal(changes.schedule as Record<string, unknown>, resolvedTimezone);
        if (!event.timezone) {
          event.timezone = resolvedTimezone;
        }
      }

      const shouldRefreshDeliveryState = scheduleChanged || timezoneChanged || timeSemanticsChanged || notificationsChanged;
      if (shouldRefreshDeliveryState) {
        event.deliveryState = undefined;
        event.deliveryText = undefined;
        event.deliveryTextGeneratedAt = undefined;
        event.deliveryPreparedNotificationId = undefined;
        event.deliveryPreparedNotifyAt = undefined;
        if (event.status === "active") {
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
      }
      if (event.category === "scheduled-task") {
        event.note = buildScheduledTaskPrompt(event.title, event.note);
      }
      event.updatedAt = new Date().toISOString();
      await updateScheduleEvent(config, event);
      if (!shouldGenerateScheduledTaskOnDelivery(event)) {
        await enqueueSchedulePreparationTask(config, event.id, task.source, [task.id]);
      }
      changedIds.push(event.id);
    }
    return { changed: true, scheduleId: changedIds[0], scheduleIds: changedIds };
  }

  if (task.operation === "delete") {
    const resolved = await resolveSchedulesForMutation(config, task, ["active"]);
    if (resolved.events.length === 0) return { skipped: true, reason: resolved.reason || "schedule-not-resolved" };
    const changedIds: string[] = [];
    for (const event of resolved.events) {
      const changed = await deleteScheduleEvent(config, event.id);
      if (changed) changedIds.push(event.id);
    }
    return { changed: changedIds.length > 0, scheduleId: changedIds[0], scheduleIds: changedIds };
  }

  if (task.operation === "pause") {
    const resolved = await resolveSchedulesForMutation(config, task, ["active"]);
    if (resolved.events.length === 0) return { skipped: true, reason: resolved.reason || "schedule-not-resolved" };
    const changedIds: string[] = [];
    for (const event of resolved.events) {
      event.status = "paused";
      event.updatedAt = new Date().toISOString();
      event.deliveryText = undefined;
      event.deliveryTextGeneratedAt = undefined;
      event.deliveryPreparedNotificationId = undefined;
      event.deliveryPreparedNotifyAt = undefined;
      await updateScheduleEvent(config, event);
      changedIds.push(event.id);
    }
    return { changed: true, scheduleId: changedIds[0], scheduleIds: changedIds };
  }

  if (task.operation === "resume") {
    const resolved = await resolveSchedulesForMutation(config, task, ["paused"]);
    if (resolved.events.length === 0) return { skipped: true, reason: resolved.reason || "schedule-not-resolved" };
    const changedIds: string[] = [];
    for (const event of resolved.events) {
      event.status = "active";
      event.updatedAt = new Date().toISOString();
      event.deliveryText = undefined;
      event.deliveryTextGeneratedAt = undefined;
      event.deliveryPreparedNotificationId = undefined;
      event.deliveryPreparedNotifyAt = undefined;
      event.deliveryState = undefined;
      await updateScheduleEvent(config, event);
      if (!shouldGenerateScheduledTaskOnDelivery(event)) {
        await enqueueSchedulePreparationTask(config, event.id, task.source, [task.id]);
      }
      changedIds.push(event.id);
    }
    return { changed: true, scheduleId: changedIds[0], scheduleIds: changedIds };
  }

  return { skipped: true, reason: "unsupported-schedule-operation" };
}
