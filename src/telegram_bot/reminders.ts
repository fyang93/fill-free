import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { InlineKeyboard, type Bot, type Context } from "grammy";
import type { AppConfig } from "./types";
import { logger } from "./logger";

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
    await bot.api.sendMessage(config.telegram.allowedUserId, `⏰ 提醒\n${reminder.text}`);
    reminder.status = "sent";
    reminder.sentAt = new Date().toISOString();
    sent += 1;
    changed = true;
  }
  if (changed) await writeReminders(config, reminders);
  return sent;
}

function formatReminder(reminder: Reminder): string {
  return `${new Date(reminder.scheduledAt).toLocaleString("zh-CN", { hour12: false }).slice(0, 16)} ${reminder.text}`;
}

function buildListKeyboard(reminders: Reminder[], page: number): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const totalPages = Math.max(1, Math.ceil(reminders.length / PAGE_SIZE));
  const start = page * PAGE_SIZE;
  const pageItems = reminders.slice(start, start + PAGE_SIZE);
  pageItems.forEach((item) => keyboard.text(formatReminder(item).slice(0, 60), `${REMINDER_CALLBACK_PREFIX}view:${item.id}`).row());
  if (totalPages > 1) {
    if (page > 0) keyboard.text("⬅ 上一页", `${REMINDER_CALLBACK_PREFIX}page:${page - 1}`);
    if (page < totalPages - 1) keyboard.text("下一页 ➡", `${REMINDER_CALLBACK_PREFIX}page:${page + 1}`);
  }
  return keyboard;
}

export async function showReminderList(config: AppConfig, ctx: Context, page = 0): Promise<void> {
  const reminders = await listPendingReminders(config);
  if (reminders.length === 0) {
    await ctx.reply("当前没有待提醒事项。");
    return;
  }
  await ctx.reply(`待提醒事项（${reminders.length}）`, { reply_markup: buildListKeyboard(reminders, page) });
}

function buildDetailKeyboard(reminderId: string): InlineKeyboard {
  return new InlineKeyboard().text("删除", `${REMINDER_CALLBACK_PREFIX}delete:${reminderId}`).row().text("返回列表", `${REMINDER_CALLBACK_PREFIX}page:0`);
}

function buildDeleteConfirmKeyboard(reminderId: string): InlineKeyboard {
  return new InlineKeyboard().text("确认删除", `${REMINDER_CALLBACK_PREFIX}confirm-delete:${reminderId}`).text("取消", `${REMINDER_CALLBACK_PREFIX}view:${reminderId}`);
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
    await ctx.api.editMessageText(ctx.chat.id, messageId, `待提醒事项（${reminders.length}）`, { reply_markup: buildListKeyboard(reminders, Number(value || 0)) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (action === "view") {
    const reminder = await getReminder(config, value);
    if (!reminder || reminder.status !== "pending") {
      await ctx.answerCallbackQuery({ text: "提醒不存在或已处理", show_alert: true });
      return true;
    }
    await ctx.api.editMessageText(ctx.chat.id, messageId, `⏰ 提醒详情\n时间：${new Date(reminder.scheduledAt).toLocaleString("zh-CN", { hour12: false })}\n内容：${reminder.text}`, { reply_markup: buildDetailKeyboard(reminder.id) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (action === "delete") {
    const reminder = await getReminder(config, value);
    if (!reminder || reminder.status !== "pending") {
      await ctx.answerCallbackQuery({ text: "提醒不存在或已处理", show_alert: true });
      return true;
    }
    await ctx.api.editMessageText(ctx.chat.id, messageId, `确认删除这个提醒？\n时间：${new Date(reminder.scheduledAt).toLocaleString("zh-CN", { hour12: false })}\n内容：${reminder.text}`, { reply_markup: buildDeleteConfirmKeyboard(reminder.id) });
    await ctx.answerCallbackQuery();
    return true;
  }

  if (action === "confirm-delete") {
    await deleteReminder(config, value);
    const reminders = await listPendingReminders(config);
    if (reminders.length === 0) {
      await ctx.api.editMessageText(ctx.chat.id, messageId, "当前没有待提醒事项。");
    } else {
      await ctx.api.editMessageText(ctx.chat.id, messageId, `待提醒事项（${reminders.length}）`, { reply_markup: buildListKeyboard(reminders, 0) });
    }
    await ctx.answerCallbackQuery({ text: "已删除提醒" });
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
