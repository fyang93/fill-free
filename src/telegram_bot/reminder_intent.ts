import type { Context } from "grammy";
import { logger } from "./logger";
import type { PromptReminderDraft } from "./opencode/types";
import type { OpenCodeService } from "./opencode";
import { persistState, rememberUserTimezone } from "./state";
import { buildReminderScheduleFromExternal } from "./reminders/schedule_parser";
import { createReminderEventWithDefaults, formatReminderEvent, isValidReminderTimezone, prepareReminderDeliveryText, resolveReminderTimezone, updateReminderEvent, type ReminderEvent, type ReminderNotification } from "./reminders";
import type { AppConfig } from "./types";
import { resolveReminderTargetUser, resolveTelegramTargetUsers, type ReminderTargetResolution } from "./telegram_identity";

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

function reminderCreatedFact(config: AppConfig, event: ReminderEvent, requesterUserId: number | undefined, target: ReminderTargetResolution): string {
  const details = formatReminderEvent(config, event);
  if (target.chatId) {
    return `Reminder created. Target chat: ${target.displayName || String(target.chatId)}. Details: ${details}.`;
  }
  if (!target.userId || target.userId === requesterUserId) {
    return `Reminder created for the requester. Details: ${details}.`;
  }
  return `Reminder created. Recipient: ${target.displayName || String(target.userId)}. Details: ${details}.`;
}

export async function createStructuredReminders(
  config: AppConfig,
  opencode: OpenCodeService,
  rawReminders: PromptReminderDraft[],
  ctx: Context,
  userId?: number,
  telegramMessageTime?: string,
): Promise<{ created: string[]; clarifications: string[] }> {
  const created: string[] = [];
  const clarifications: string[] = [];
  let timezoneChanged = false;

  for (const raw of rawReminders) {
    const title = typeof raw.title === "string" ? raw.title.trim() : "";
    const scheduleRaw = raw.schedule;
    if (!title || !scheduleRaw || typeof scheduleRaw !== "object") continue;
    const explicitTimezone = typeof raw.timezone === "string" && raw.timezone.trim() ? raw.timezone.trim() : undefined;
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
            displayName: target.displayName || undefined,
          };
        }
        if (target.chatId) {
          return {
            targetKind: "chat" as const,
            targetId: target.chatId,
            displayName: target.displayName,
          };
        }
        if (target.userId) {
          return {
            targetKind: "user" as const,
            targetId: target.userId,
            displayName: target.displayName,
          };
        }
        return null;
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (targets.length === 0) continue;

    const primaryTarget = targetResult.resolved[0] || resolveReminderTargetUser(config, raw.targetUser, ctx, userId);
    const event = await createReminderEventWithDefaults(config, {
      title,
      note: typeof raw.note === "string" ? raw.note.trim() || undefined : undefined,
      schedule: buildReminderScheduleFromExternal(scheduleRaw),
      category: raw.category === "special" ? "special" : raw.category === "routine" ? "routine" : undefined,
      specialKind: raw.specialKind === "birthday" || raw.specialKind === "festival" || raw.specialKind === "anniversary" || raw.specialKind === "memorial" ? raw.specialKind : undefined,
      kind: raw.kind === "routine" || raw.kind === "meeting" || raw.kind === "birthday" || raw.kind === "anniversary" || raw.kind === "festival" || raw.kind === "memorial" || raw.kind === "task" || raw.kind === "custom" ? raw.kind : undefined,
      timeSemantics,
      timezone: resolveReminderTimezone(config, { explicitTimezone, telegramMessageTime, timeSemantics, userId }),
      targets,
      notifications: buildReminderNotifications(raw.notifications),
    });
    try {
      if (await prepareReminderDeliveryText(config, opencode, event)) {
        await updateReminderEvent(config, event);
      }
    } catch (error) {
      await logger.warn(`failed to pre-generate reminder message for ${event.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (explicitTimezone && isValidReminderTimezone(explicitTimezone)) {
      rememberUserTimezone(userId, explicitTimezone);
      timezoneChanged = true;
    }
    created.push(reminderCreatedFact(config, event, userId, primaryTarget));
  }

  if (timezoneChanged) {
    await persistState(config.paths.stateFile);
  }
  return { created, clarifications };
}
