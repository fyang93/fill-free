import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { AppConfig } from "./types";
import { logger } from "./logger";
import { t, uiLocaleTag } from "./i18n";
import { editMessageTextFormatted, replyFormatted, sendMessageFormatted } from "./telegram_format";

export type Reminder = {
  id: string;
  text: string;
  scheduledAt: string;
  status: "pending" | "sent" | "deleted";
  createdAt: string;
  sentAt?: string;
};

const REMINDER_CALLBACK_PREFIX = "reminder:";
const PAGE_SIZE = 8;

function remindersPath(config: AppConfig): string {
  return path.join(config.paths.repoRoot, "index", "reminders.json");
}

async function readReminders(config: AppConfig): Promise<Reminder[]> {
  const filePath = remindersPath(config);
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeReminders(config: AppConfig, reminders: Reminder[]): Promise<void> {
  const filePath = remindersPath(config);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(reminders, null, 2), "utf8");
}

function normalizeScheduledAt(input: string): string {
  const parsed = Date.parse(input);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid reminder time: ${input}`);
  }
  return new Date(parsed).toISOString();
}

export async function createReminder(config: AppConfig, text: string, scheduledAt: string): Promise<Reminder> {
  const reminders = await readReminders(config);
  const reminder: Reminder = {
    id: `rmd_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text,
    scheduledAt: normalizeScheduledAt(scheduledAt),
    status: "pending",
    createdAt: new Date().toISOString(),
  };
  reminders.push(reminder);
  await writeReminders(config, reminders);
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
  const reminders = await readReminders(config);
  let changed = false;
  const next = reminders.map((item) => {
    if (item.id === id && item.status === "pending") {
      changed = true;
      return { ...item, status: "deleted" as const };
    }
    return item;
  });
  if (changed) {
    await writeReminders(config, next);
  }
  return changed;
}

export async function deliverDueReminders(config: AppConfig, bot: Bot<Context>): Promise<number> {
  const reminders = await readReminders(config);
  const now = Date.now();
  let sent = 0;
  let changed = false;
  for (const reminder of reminders) {
    if (reminder.status !== "pending") continue;
    const ts = Date.parse(reminder.scheduledAt);
    if (!Number.isFinite(ts) || ts > now) continue;
    for (const userId of config.telegram.allowedUserIds) {
      await sendMessageFormatted(bot, userId, t(config, "reminder_delivery", { text: reminder.text }));
    }
    reminder.status = "sent";
    reminder.sentAt = new Date().toISOString();
    sent += 1;
    changed = true;
  }
  if (changed) await writeReminders(config, reminders);
  return sent;
}

function formatReminder(config: AppConfig, reminder: Reminder): string {
  return `${new Date(reminder.scheduledAt).toLocaleString(uiLocaleTag(config), { hour12: false }).slice(0, 16)} ${reminder.text}`;
}

function buildListKeyboard(config: AppConfig, reminders: Reminder[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(reminders.length / PAGE_SIZE));
  const start = page * PAGE_SIZE;
  const pageItems = reminders.slice(start, start + PAGE_SIZE);
  pageItems.forEach((item) => keyboard.text(formatReminder(config, item).slice(0, 60), `${REMINDER_CALLBACK_PREFIX}view:${item.id}`).row());
  if (totalPages > 1) {
    if (page > 0) keyboard.text(t(config, "reminder_prev"), `${REMINDER_CALLBACK_PREFIX}page:${page - 1}`);
    if (page < totalPages - 1) keyboard.text(t(config, "reminder_next"), `${REMINDER_CALLBACK_PREFIX}page:${page + 1}`);
  }
  return keyboard;
}

export async function showReminderList(config: AppConfig, ctx: Context, page = 0): Promise<void> {
  const reminders = await listPendingReminders(config);
  if (reminders.length === 0) {
    await replyFormatted(ctx, t(config, "reminder_none"));
    return;
  }
  await replyFormatted(ctx, t(config, "reminder_list_title", { count: reminders.length }), { reply_markup: buildListKeyboard(config, reminders, page) });
}

function buildDetailKeyboard(config: AppConfig, reminderId: string): InlineKeyboard {
  return new InlineKeyboard().text(t(config, "reminder_delete"), `${REMINDER_CALLBACK_PREFIX}delete:${reminderId}`).row().text(t(config, "reminder_back"), `${REMINDER_CALLBACK_PREFIX}page:0`);
}

function buildDeleteConfirmKeyboard(config: AppConfig, reminderId: string): InlineKeyboard {
  return new InlineKeyboard().text(t(config, "reminder_confirm_delete"), `${REMINDER_CALLBACK_PREFIX}confirm-delete:${reminderId}`).text(t(config, "reminder_cancel"), `${REMINDER_CALLBACK_PREFIX}view:${reminderId}`);
}

export async function handleReminderCallback(config: AppConfig, ctx: Context): Promise<boolean> {
  const callback = ctx.callbackQuery;
  const data = callback?.data || "";
  if (!data.startsWith(REMINDER_CALLBACK_PREFIX)) return false;
  const rest = data.slice(REMINDER_CALLBACK_PREFIX.length);
  const [action, value] = rest.split(":", 2);
  if (!ctx.chat || !callback?.message?.message_id) return true;
  const messageId = callback.message.message_id;

  if (action === "page") {
    const reminders = await listPendingReminders(config);
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, t(config, "reminder_list_title", { count: reminders.length }), { reply_markup: buildListKeyboard(config, reminders, Number(value || 0)) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (action === "view") {
    const reminder = await getReminder(config, value);
    if (!reminder || reminder.status !== "pending") {
      await ctx.answerCallbackQuery({ text: t(config, "reminder_missing"), show_alert: true });
      return true;
    }
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, t(config, "reminder_detail", {
      time: new Date(reminder.scheduledAt).toLocaleString(uiLocaleTag(config), { hour12: false }),
      text: reminder.text,
    }), { reply_markup: buildDetailKeyboard(config, reminder.id) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (action === "delete") {
    const reminder = await getReminder(config, value);
    if (!reminder || reminder.status !== "pending") {
      await ctx.answerCallbackQuery({ text: t(config, "reminder_missing"), show_alert: true });
      return true;
    }
    await editMessageTextFormatted(ctx, ctx.chat.id, messageId, t(config, "reminder_delete_confirm", {
      time: new Date(reminder.scheduledAt).toLocaleString(uiLocaleTag(config), { hour12: false }),
      text: reminder.text,
    }), { reply_markup: buildDeleteConfirmKeyboard(config, reminder.id) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (action === "confirm-delete") {
    await deleteReminder(config, value);
    const reminders = await listPendingReminders(config);
    if (reminders.length === 0) {
      await editMessageTextFormatted(ctx, ctx.chat.id, messageId, t(config, "reminder_none"));
    } else {
      await editMessageTextFormatted(ctx, ctx.chat.id, messageId, t(config, "reminder_list_title", { count: reminders.length }), { reply_markup: buildListKeyboard(config, reminders, 0) });
    }
    await ctx.answerCallbackQuery({ text: t(config, "reminder_deleted") });
    return true;
  }

  await ctx.answerCallbackQuery();
  return true;
}

export async function startReminderLoop(config: AppConfig, bot: Bot<Context>): Promise<NodeJS.Timeout> {
  return setInterval(async () => {
    try {
      const sent = await deliverDueReminders(config, bot);
      if (sent > 0) await logger.info(`sent ${sent} reminders`);
    } catch (error) {
      await logger.error(`reminder loop failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, 30000);
}
