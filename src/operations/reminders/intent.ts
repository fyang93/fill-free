import type { Context } from "grammy";
import type { ReminderDraft } from "support/ai/types";
import type { AiService } from "support/ai";
import { rememberUserTimezone } from "scheduling/app/state";
import { isValidReminderTimezone, resolveReminderTimezone, type ReminderNotification } from ".";
import { enqueueReminderCreateTask } from "./task-actions";
import type { AppConfig } from "scheduling/app/types";
import { resolveChatDisplayName, resolveUserDisplayName } from "operations/context/store";
import { resolveReminderTargetUser, resolveTelegramTargetUsers, type ReminderTargetResolution } from "interaction/telegram/identity";

function buildReminderNotifications(raw: unknown): ReminderNotification[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const notifications: ReminderNotification[] = [];
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

function reminderCreatedFact(config: AppConfig, details: string, requesterUserId: number | undefined, target: ReminderTargetResolution): string {
  if (target.chatId) {
    return `已受理提醒目标：${resolveChatDisplayName(config.paths.repoRoot, target.chatId) || target.displayName || String(target.chatId)}；详情：${details}`;
  }
  if (!target.userId || target.userId === requesterUserId) {
    return `已受理提醒目标：当前请求者；详情：${details}`;
  }
  return `已受理提醒目标：${resolveUserDisplayName(config.paths.repoRoot, target.userId) || target.displayName || String(target.userId)}；详情：${details}`;
}

export async function createStructuredReminders(
  config: AppConfig,
  agentService: AiService,
  rawReminders: ReminderDraft[],
  ctx: Context,
  userId?: number,
  messageTime?: string,
): Promise<{ created: string[]; clarifications: string[] }> {
  const created: string[] = [];
  const clarifications: string[] = [];
  let timezoneChanged = false;

  for (const raw of rawReminders) {
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

    const primaryTarget = targetResult.resolved[0] || resolveReminderTargetUser(config, raw.targetUser, ctx, userId);
    const recipientUserId = targets.find((target) => target.targetKind === "user")?.targetId;
    const isSelfOnlyTarget = targets.length === 1 && targets[0]?.targetKind === "user" && targets[0]?.targetId === userId;
    const scheduleKind = typeof (scheduleRaw as Record<string, unknown>).kind === "string" ? String((scheduleRaw as Record<string, unknown>).kind).trim() : "";
    const normalizedTimezone = isSelfOnlyTarget && scheduleKind && scheduleKind !== "once"
      ? resolveReminderTimezone(config, { subjectTimezone, messageTime, timeSemantics, recipientUserId, userId })
      : resolveReminderTimezone(config, { explicitTimezone, subjectTimezone, messageTime, timeSemantics, recipientUserId, userId });
    await enqueueReminderCreateTask(config, {
      title,
      note: typeof raw.note === "string" ? raw.note.trim() || undefined : undefined,
      schedule: scheduleRaw as Record<string, unknown>,
      category: raw.category === "special" ? "special" : raw.category === "routine" ? "routine" : undefined,
      specialKind: raw.specialKind === "birthday" || raw.specialKind === "festival" || raw.specialKind === "anniversary" || raw.specialKind === "memorial" ? raw.specialKind : undefined,
      kind: raw.kind === "routine" || raw.kind === "meeting" || raw.kind === "birthday" || raw.kind === "anniversary" || raw.kind === "festival" || raw.kind === "memorial" || raw.kind === "task" || raw.kind === "custom" ? raw.kind : undefined,
      timeSemantics,
      timezone: normalizedTimezone,
      targets,
      notifications: buildReminderNotifications(raw.notifications),
    }, {
      requesterUserId: userId,
      chatId: ctx.chat?.id,
      messageId: ctx.message?.message_id,
    });
    if (explicitTimezone && isValidReminderTimezone(explicitTimezone)) {
      rememberUserTimezone(userId, explicitTimezone);
      timezoneChanged = true;
    }
    const details = `${typeof scheduleRaw.kind === "string" ? scheduleRaw.kind : "once"} ${typeof scheduleRaw.scheduledAt === "string" ? scheduleRaw.scheduledAt : typeof scheduleRaw.date === "string" ? scheduleRaw.date : title}`;
    created.push(reminderCreatedFact(config, details, userId, primaryTarget));
  }

  if (timezoneChanged) {
    // timezone is already persisted in system/users.json by rememberUserTimezone
  }
  return { created, clarifications };
}
