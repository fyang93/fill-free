import { logger } from "bot/app/logger";
import { canManageAllSchedules, canManageOwnSchedules, canReadSchedules, canRequesterCreateScheduleTargets } from "bot/operations/access/control";
import { accessLevelForUser } from "bot/operations/access/roles";
import { resolveScheduleDisplayTimezone, resolveSchedulesByMatch, scheduleEventScheduleSummary, type ScheduleEvent } from "bot/operations/schedules";
import { buildScheduleScheduleFromExternal } from "bot/operations/schedules/schedule_parser";
import { createScheduleEventWithDefaults, readScheduleEvents } from "bot/operations/schedules/store";
import { runScheduleTask } from "bot/operations/schedules/task-actions";
import type { RepoCliContext } from "cli/runtime";

function localScheduledAt(context: RepoCliContext, event: ScheduleEvent): string | undefined {
  if (event.schedule.kind !== "once") return undefined;
  const date = new Date(event.schedule.scheduledAt);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat("sv-SE", {
    timeZone: resolveScheduleDisplayTimezone(context.config, event),
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

function serializeScheduleForCli(context: RepoCliContext, event: ScheduleEvent): Record<string, unknown> {
  return {
    ...event,
    scheduleSummary: scheduleEventScheduleSummary(context.config, event),
    scheduledAtLocal: localScheduledAt(context, event),
  };
}

export async function handleSchedulesList(context: RepoCliContext): Promise<void> {
  const requesterUserId = context.asInt(context.args.requesterUserId);
  const accessLevel = accessLevelForUser(context.config, requesterUserId);
  if (!canReadSchedules(accessLevel)) context.output({ ok: false, error: "schedule-read-not-allowed" });
  const schedules = (await readScheduleEvents(context.config)).filter((event) => event.status !== "deleted");
  const visible = canManageAllSchedules(accessLevel)
    ? schedules
    : schedules.filter((event) => canManageOwnSchedules(accessLevel) && event.createdByUserId === requesterUserId);
  context.output({ ok: true, schedules: visible.map((event) => serializeScheduleForCli(context, event)) });
}

export async function handleSchedulesGet(context: RepoCliContext): Promise<void> {
  const scheduleId = context.cleanText(context.args.scheduleId);
  const requesterUserId = context.asInt(context.args.requesterUserId);
  const accessLevel = accessLevelForUser(context.config, requesterUserId);
  if (!canReadSchedules(accessLevel)) context.output({ ok: false, error: "schedule-read-not-allowed" });
  if (scheduleId) {
    const schedules = await readScheduleEvents(context.config);
    const schedule = schedules.find((item) => item.id === scheduleId) || null;
    if (!schedule) {
      context.output({ ok: false, error: "schedule-not-resolved", schedule: null });
    }
    if (!canManageAllSchedules(accessLevel) && schedule.createdByUserId !== requesterUserId) {
      context.output({ ok: false, error: "schedule-read-not-allowed" });
    }
    context.output({ ok: true, schedule: serializeScheduleForCli(context, schedule) });
  }

  const match = context.parseObjectArg(context.args.match) || {};
  const result = await resolveSchedulesByMatch(context.config, {
    match,
    requesterUserId,
    allowedStatuses: ["active", "paused"],
  });
  if (result.events.length !== 1) {
    context.output({
      ok: false,
      error: result.reason || "schedule-not-resolved",
      schedules: result.events.map((event) => serializeScheduleForCli(context, event)),
    });
  }
  context.output({ ok: true, schedule: serializeScheduleForCli(context, result.events[0]) });
}

export async function handleSchedulesCreate(context: RepoCliContext): Promise<void> {
  const { args, cleanText, asInt, parseObjectArg, output, logTextContent } = context;
  const title = cleanText(args.title);
  const note = cleanText(args.note);
  const requesterUserId = asInt(args.requesterUserId);
  const targetUserId = asInt(args.targetUserId) || requesterUserId;
  const targetChatId = asInt(args.targetChatId);
  const schedule = parseObjectArg(args.schedule);
  await logger.info(`system tool schedules_create request hasTitle=${title ? "yes" : "no"} hasSchedule=${schedule ? "yes" : "no"} scheduleKind=${typeof schedule?.kind === "string" ? schedule.kind : typeof schedule?.datetime === "string" ? "datetime" : "unknown"} targetUserId=${targetUserId ?? "unknown"} targetChatId=${targetChatId ?? "unknown"} note=${note ? logTextContent(note) : '""'}`);
  if (!title || !schedule || (!targetUserId && targetChatId == null)) output({ ok: false, error: "missing-title-schedule-or-target", details: { hasTitle: Boolean(title), hasSchedule: Boolean(schedule), hasTarget: Boolean(targetUserId || targetChatId != null) } });

  const targets = targetChatId != null ? [{ targetKind: "chat" as const, targetId: targetChatId }] : [{ targetKind: "user" as const, targetId: targetUserId! }];
  if (!canRequesterCreateScheduleTargets(context.config, requesterUserId, targets)) {
    output({ ok: false, error: "schedule-create-not-allowed" });
  }

  const timezone = cleanText(args.timezone) || context.config.bot.defaultTimezone;
  const category = cleanText(args.category);
  const rawSpecialKind = cleanText(args.specialKind);
  const rawTimeSemantics = cleanText(args.timeSemantics);
  const normalizedCategory = rawSpecialKind === "scheduled-task" || rawTimeSemantics === "scheduled-task"
    ? "scheduled-task"
    : category === "scheduled-task"
      ? "scheduled-task"
      : category === "special"
        ? "special"
        : category === "routine"
          ? "routine"
          : undefined;
  const normalizedSpecialKind = rawSpecialKind === "birthday" || rawSpecialKind === "festival" || rawSpecialKind === "anniversary" || rawSpecialKind === "memorial"
    ? rawSpecialKind as "birthday" | "festival" | "anniversary" | "memorial"
    : undefined;

  const event = await createScheduleEventWithDefaults(context.config, {
    title: title as string,
    note,
    schedule: buildScheduleScheduleFromExternal(schedule as Record<string, unknown>, timezone),
    category: normalizedCategory,
    createdByUserId: requesterUserId,
    timeSemantics: rawTimeSemantics === "absolute" || rawTimeSemantics === "local" ? rawTimeSemantics : undefined,
    specialKind: normalizedSpecialKind,
    targets,
  });
  await logger.info(`system tool schedules_create created scheduleId=${event.id} title=${logTextContent(event.title)}`);
  output({ ok: true, changed: true, scheduleId: event.id, schedule: serializeScheduleForCli(context, event) });
}

export async function handleScheduleMutation(context: RepoCliContext, operation: "update" | "delete" | "pause" | "resume"): Promise<void> {
  const requesterUserId = context.asInt(context.args.requesterUserId);
  const match = context.parseObjectArg(context.args.match) || {};
  const changes = context.parseObjectArg(context.args.changes) || {};
  const scheduleIds = Array.isArray(context.args.scheduleIds)
    ? context.args.scheduleIds.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim())
    : [];
  if (scheduleIds.length > 0 && !Array.isArray((match as Record<string, unknown>).scheduleIds)) {
    (match as Record<string, unknown>).scheduleIds = scheduleIds;
  }
  if (operation === "update") {
    const title = context.cleanText(context.args.title);
    const note = context.cleanText(context.args.note);
    const timezone = context.cleanText(context.args.timezone);
    const timeSemantics = context.cleanText(context.args.timeSemantics);
    const category = context.cleanText(context.args.category);
    const specialKind = context.cleanText(context.args.specialKind);
    const targetUserId = context.asInt(context.args.targetUserId);
    const targetChatId = context.asInt(context.args.targetChatId);
    const schedule = context.parseObjectArg(context.args.schedule);
    const targets = context.parseObjectArg(context.args.targets)?.targets;
    if (title && changes.title == null) changes.title = title;
    if (note !== undefined && changes.note == null) changes.note = note;
    if (timezone && changes.timezone == null) changes.timezone = timezone;
    if ((timeSemantics === "absolute" || timeSemantics === "local") && changes.timeSemantics == null) changes.timeSemantics = timeSemantics;
    if ((category === "routine" || category === "special" || category === "scheduled-task") && changes.category == null) changes.category = category;
    if ((specialKind === "birthday" || specialKind === "festival" || specialKind === "anniversary" || specialKind === "memorial") && changes.specialKind == null) changes.specialKind = specialKind;
    if (schedule && changes.schedule == null) changes.schedule = schedule;
    if (Array.isArray(targets) && changes.targets == null) changes.targets = targets;
    if (typeof targetUserId === "number" && changes.targetUserId == null) changes.targetUserId = targetUserId;
    if (typeof targetChatId === "number" && changes.targetChatId == null) changes.targetChatId = targetChatId;
  }
  const payload = operation === "update"
    ? { match, changes }
    : { match };
  const result = await runScheduleTask(context.config, {
    id: `tool_${Date.now().toString(36)}`,
    state: "queued",
    domain: "schedules",
    operation,
    payload,
    source: requesterUserId ? { requesterUserId } : undefined,
    createdAt: context.nowIso(),
    updatedAt: context.nowIso(),
  });
  if (result.skipped) {
    context.output({ ok: false, error: typeof result.reason === "string" && result.reason ? result.reason : `schedule-${operation}-failed`, ...result });
  }
  const schedules = result.scheduleIds && result.scheduleIds.length > 0
    ? (await readScheduleEvents(context.config)).filter((event) => result.scheduleIds?.includes(event.id)).map((event) => serializeScheduleForCli(context, event))
    : undefined;
  const schedule = schedules && schedules.length > 0
    ? schedules.find((item) => item.id === result.scheduleId) || schedules[0]
    : undefined;
  context.output({ ok: true, ...result, schedule, schedules });
}
