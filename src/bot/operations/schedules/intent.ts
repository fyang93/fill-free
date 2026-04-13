import type { Context } from "grammy";
import type { ScheduleDraft } from "bot/ai/types";
import type { AiService } from "bot/ai";
import { rememberUserTimezone } from "bot/app/state";
import { buildDefaultScheduleNotifications, defaultScheduleTimeSemantics, isValidScheduleTimezone, resolveScheduleTimezone, scheduleEventScheduleSummary, type ScheduleNotification } from ".";
import { enqueueScheduleCreateTask } from "./task-actions";
import { buildScheduleScheduleFromExternal } from "./schedule_parser";
import type { AppConfig } from "bot/app/types";
import { resolveChatDisplayName, resolveUserDisplayName } from "bot/operations/context/store";
import { resolveScheduleTargetUser, resolveTelegramTargetUsers, type ScheduleTargetResolution } from "bot/telegram/identity";

function buildScheduleNotifications(raw: unknown): ScheduleNotification[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const notifications: ScheduleNotification[] = [];
  raw.forEach((item, index) => {
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    const offsetMinutes = Number(record.offsetMinutes);
    if (!Number.isInteger(offsetMinutes)) return;
    notifications.push({
      id: typeof record.id === "string" && record.id.trim() ? record.id.trim() : `n${index + 1}`,
      offsetMinutes,
      enabled: record.enabled !== false,
      label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : undefined,
    });
  });
  return notifications.length > 0 ? notifications : undefined;
}

function scheduleCreatedFact(config: AppConfig, details: string, requesterUserId: number | undefined, target: ScheduleTargetResolution): string {
  if (target.chatId) {
    return `已受理提醒目标：${resolveChatDisplayName(config.paths.repoRoot, target.chatId) || target.displayName || String(target.chatId)}；详情：${details}`;
  }
  if (!target.userId || target.userId === requesterUserId) {
    return `已受理提醒目标：当前请求者；详情：${details}`;
  }
  return `已受理提醒目标：${resolveUserDisplayName(config.paths.repoRoot, target.userId) || target.displayName || String(target.userId)}；详情：${details}`;
}

function summarizeDraftSchedule(config: AppConfig, input: {
  title: string;
  note?: string;
  scheduleRaw: Record<string, unknown>;
  timezone: string;
  timeSemantics?: "absolute" | "local";
  specialKind?: "birthday" | "festival" | "anniversary" | "memorial";
}): string {
  try {
    const schedule = buildScheduleScheduleFromExternal(input.scheduleRaw, input.timezone);
    return scheduleEventScheduleSummary(config, {
      id: "draft",
      title: input.title,
      note: input.note,
      schedule,
      timezone: input.timezone,
      timeSemantics: input.timeSemantics || defaultScheduleTimeSemantics(schedule),
      notifications: buildDefaultScheduleNotifications(config, { specialKind: input.specialKind }),
      status: "active",
      createdAt: new Date().toISOString(),
      targets: [],
      specialKind: input.specialKind,
      category: input.specialKind ? "special" : undefined,
    });
  } catch {
    return `${typeof input.scheduleRaw.kind === "string" ? input.scheduleRaw.kind : "once"} ${typeof input.scheduleRaw.scheduledAt === "string" ? input.scheduleRaw.scheduledAt : typeof input.scheduleRaw.date === "string" ? input.scheduleRaw.date : input.title}`;
  }
}

export async function createStructuredSchedules(
  config: AppConfig,
  _agentService: AiService,
  rawSchedules: ScheduleDraft[],
  ctx: Context,
  userId?: number,
  messageTime?: string,
): Promise<{ created: string[]; clarifications: string[] }> {
  const created: string[] = [];
  const clarifications: string[] = [];
  let timezoneChanged = false;

  for (const raw of rawSchedules) {
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const scheduleRaw = raw.schedule;
    if (!title || !scheduleRaw || typeof scheduleRaw !== "object") continue;
    const explicitTimezone = typeof raw.timezone === "string" && raw.timezone.trim() ? raw.timezone.trim() : undefined;
    const subjectTimezone = typeof raw.subjectTimezone === "string" && raw.subjectTimezone.trim() ? raw.subjectTimezone.trim() : undefined;
    const timeSemantics = raw.timeSemantics === "absolute" || raw.timeSemantics === "local" ? raw.timeSemantics : undefined;
    const rawTargets = Array.isArray(raw.targetUsers) && raw.targetUsers.length > 0
      ? raw.targetUsers
      : raw.targetUser
        ? [raw.targetUser]
        : [undefined];
    const targetResult = resolveTelegramTargetUsers(config, rawTargets, ctx, userId);
    if (targetResult.clarifications.length > 0) {
      clarifications.push(...targetResult.clarifications);
      if (targetResult.resolved.length === 0) continue;
    }

    const targets = targetResult.resolved
      .map((target) => {
        if (target.status === "self") {
          if (!userId) return null;
          return {
            targetKind: "user" as const,
            targetId: userId,
          };
        }
        if (target.chatId) {
          return {
            targetKind: "chat" as const,
            targetId: target.chatId,
          };
        }
        if (target.userId) {
          return {
            targetKind: "user" as const,
            targetId: target.userId,
          };
        }
        return null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (targets.length === 0) continue;

    const primaryTarget = targetResult.resolved[0] || resolveScheduleTargetUser(config, raw.targetUser, ctx, userId);
    const recipientUserId = targets.find((target) => target.targetKind === "user")?.targetId;
    const isSelfOnlyTarget = targets.length === 1 && targets[0]?.targetKind === "user" && targets[0]?.targetId === userId;
    const scheduleKind = typeof (scheduleRaw as Record<string, unknown>).kind === "string" ? String((scheduleRaw as Record<string, unknown>).kind).trim() : "";
    const normalizedTimezone = isSelfOnlyTarget && scheduleKind && scheduleKind !== "once"
      ? resolveScheduleTimezone(config, { subjectTimezone, messageTime, timeSemantics, recipientUserId, userId })
      : resolveScheduleTimezone(config, { explicitTimezone, subjectTimezone, messageTime, timeSemantics, recipientUserId, userId });
    const specialKind = raw.specialKind === "birthday" || raw.specialKind === "festival" || raw.specialKind === "anniversary" || raw.specialKind === "memorial"
      ? raw.specialKind
      : undefined;
    await enqueueScheduleCreateTask(config, {
      title,
      note: typeof raw.note === "string" ? raw.note.trim() || undefined : undefined,
      schedule: scheduleRaw as Record<string, unknown>,
      category: raw.category === "special" || specialKind ? "special" : raw.category === "routine" ? "routine" : undefined,
      specialKind,
      timeSemantics,
      timezone: normalizedTimezone,
      targets,
      notifications: buildScheduleNotifications(raw.notifications),
    }, {
      requesterUserId: userId,
      chatId: ctx.chat?.id,
      messageId: ctx.message?.message_id,
    });
    if (explicitTimezone && isValidScheduleTimezone(explicitTimezone)) {
      rememberUserTimezone(userId, explicitTimezone);
      timezoneChanged = true;
    }
    const details = summarizeDraftSchedule(config, {
      title,
      note: typeof raw.note === "string" ? raw.note.trim() || undefined : undefined,
      scheduleRaw: scheduleRaw as Record<string, unknown>,
      timezone: normalizedTimezone,
      timeSemantics,
      specialKind,
    });
    created.push(scheduleCreatedFact(config, details, userId, primaryTarget));
  }

  if (timezoneChanged) {
    // timezone is already persisted in system/users.json by rememberUserTimezone
  }
  return { created, clarifications };
}
