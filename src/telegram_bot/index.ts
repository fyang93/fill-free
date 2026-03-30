import { Bot, InlineKeyboard, type Context } from "grammy";
import { loadConfig } from "./config";
import { saveTelegramFile, sendLocalFiles } from "./files";
import { configureLogger, logger } from "./logger";
import { OpenCodeService } from "./opencode";
import { clearRecentUploads, currentModel, getRecentUploads, loadPersistentState, persistState, rememberUploads, state, touchActivity } from "./state";
import { createReminder, handleReminderCallback, showReminderList, startReminderLoop } from "./reminders";

const MODEL_LIST_LIMIT = 30;
const MODEL_CALLBACK_PREFIX = "model:set:";
const REMINDER_HINT_RE = /(提醒|remind|reminder|到时候提醒|记得|别忘了|闹钟|alarm|schedule)/i;

const config = loadConfig();
await loadPersistentState();
configureLogger(config.paths.logFile);
const bot = new Bot(config.telegram.botToken);
const opencode = new OpenCodeService(config);

function isAuthorized(ctx: Context): boolean {
  return ctx.from?.id === config.telegram.allowedUserId;
}

async function unauthorizedGuard(ctx: Context, next: () => Promise<void>): Promise<void> {
  if (!isAuthorized(ctx)) {
    await logger.warn(`Unauthorized Telegram access from user=${ctx.from?.id ?? "unknown"}`);
    return;
  }
  touchActivity();
  await next();
}

async function setMessageReactionSafe(ctx: Context, emoji: string): Promise<void> {
  const messageId = ctx.message?.message_id;
  const chatId = ctx.chat?.id;
  if (!messageId || !chatId) return;
  try {
    await (ctx.api as any).setMessageReaction(chatId, messageId, [{ type: "emoji", emoji }], false);
  } catch {
    // ignore reaction failures
  }
}

function compactModelLabel(model: string): string {
  return model.length > 48 ? `${model.slice(0, 45)}...` : model;
}

function resolveDisplayedModel(defaults: Record<string, string>): string {
  if (state.model) return state.model;
  if (defaults.opencode) return `opencode/${defaults.opencode}`;
  const first = Object.entries(defaults)[0];
  if (first) return `${first[0]}/${first[1]}`;
  return currentModel();
}

function buildModelKeyboard(models: string[], activeModel: string | null): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  models.slice(0, MODEL_LIST_LIMIT).forEach((model, index) => {
    const label = model === activeModel ? `✅ ${compactModelLabel(model)}` : compactModelLabel(model);
    keyboard.text(label, `${MODEL_CALLBACK_PREFIX}${model}`);
    if (index % 1 === 0) keyboard.row();
  });
  return keyboard;
}

function shouldAttemptReminderParse(text: string): boolean {
  return REMINDER_HINT_RE.test(text);
}

function helpText(): string {
  return [
    "The Defect Bot Telegram 入口已就绪。",
    "",
    "你可以直接用自然语言让我：",
    "- 查询已保存的信息",
    "- 记录或更新个人信息",
    "- 整理上传到 tmp/ 的文件",
    "- 按 memory-agent 工作流处理资料",
    "",
    "上传文件后会自动保存到 tmp/telegram/日期/ 下。",
    "如果文件带说明文字，我会继续自动处理。",
    "",
    "可用命令：",
    "/help - 查看帮助",
    "/new - 新建会话",
    "/model - 查看当前模型和可选模型",
    "/model <provider/model> - 切换模型",
    "/reminders - 查看提醒列表",
  ].join("\n");
}

bot.use(unauthorizedGuard);

bot.command("help", async (ctx) => {
  await ctx.reply(helpText());
});

bot.command("new", async (ctx) => {
  const sessionId = await opencode.newSession();
  clearRecentUploads();
  await ctx.reply(`已创建新会话：${sessionId}`);
});

bot.command("reminders", async (ctx) => {
  await showReminderList(config, ctx, 0);
});

bot.command("model", async (ctx) => {
  const text = ctx.message?.text || "";
  const parts = text.trim().split(/\s+/).slice(1);

  if (parts.length === 0) {
    try {
      const { defaults, models } = await opencode.listModels();
      const activeModel = resolveDisplayedModel(defaults);
      await ctx.reply("请选择模型：", {
        reply_markup: buildModelKeyboard(models, activeModel),
      });
    } catch (error) {
      await ctx.reply(`获取模型列表失败：${error instanceof Error ? error.message : String(error)}`);
    }
    return;
  }

  const nextModel = parts[0];
  try {
    const { models } = await opencode.listModels();
    if (!models.includes(nextModel)) {
      await ctx.reply(`OpenCode 当前没有这个模型：${nextModel}`);
      return;
    }
    state.model = nextModel;
    await persistState();
    await ctx.reply(`已切换模型到：${nextModel}`);
  } catch (error) {
    await ctx.reply(`切换模型失败：${error instanceof Error ? error.message : String(error)}`);
  }
});

function messageReferenceTime(ctx: Context): string {
  const unixSeconds = ctx.message?.date;
  if (typeof unixSeconds === "number") {
    return new Date(unixSeconds * 1000).toISOString();
  }
  return new Date().toISOString();
}

async function handleIncomingText(ctx: Context): Promise<void> {
  const text = ctx.message && "text" in ctx.message ? ctx.message.text?.trim() || "" : "";
  if (!text || text.startsWith("/")) return;

  if (shouldAttemptReminderParse(text)) {
    const reminder = await opencode.parseReminderRequest(text, messageReferenceTime(ctx));
    if (reminder.shouldCreate && reminder.scheduledAt && reminder.text) {
      const created = await createReminder(config, reminder.text, reminder.scheduledAt);
      const displayTime = new Date(created.scheduledAt).toLocaleString("zh-CN", { hour12: false });
      await ctx.reply(reminder.needsConfirmation && reminder.confirmationText
        ? reminder.confirmationText
        : `好的，我会在 ${displayTime} 提醒你：${created.text}`);
      return;
    }
  }

  const recentUploads = getRecentUploads();
  await setMessageReactionSafe(ctx, "🤔");
  const waiting = await ctx.reply("机宝启动中...");
  try {
    const answer = await opencode.prompt(text, recentUploads);
    await ctx.api.editMessageText(ctx.chat!.id, waiting.message_id, answer.message || "已处理。");
    if (answer.files.length > 0) {
      const sentFiles = await sendLocalFiles(ctx, config, answer.files);
      if (sentFiles.length > 0) {
        await logger.info(`sent files back to telegram: ${sentFiles.join(", ")}`);
      } else {
        await logger.warn(`file send failed for candidates: ${answer.files.join(", ")}`);
        await ctx.reply("我找到了相关文件，但这次发送失败了。");
      }
    }
    await setMessageReactionSafe(ctx, "👍");
  } catch (error) {
    await logger.error(`text handling failed: ${error instanceof Error ? error.message : String(error)}`);
    await ctx.api.editMessageText(ctx.chat!.id, waiting.message_id, `处理失败：${error instanceof Error ? error.message : String(error)}`);
    await setMessageReactionSafe(ctx, "👎");
  }
}

async function handleIncomingFile(ctx: Context): Promise<void> {
  const caption = ctx.message && "caption" in ctx.message ? ctx.message.caption?.trim() || "" : "";
  try {
    await setMessageReactionSafe(ctx, "🤔");
    const uploaded = await saveTelegramFile(ctx, config);
    if (!uploaded) return;

    await logger.info(`saved telegram file ${uploaded.savedPath}`);
    rememberUploads([uploaded]);

    if (!caption) {
      await ctx.reply([
        "文件已保存。",
        `path: ${uploaded.savedPath}`,
        "你可以继续直接告诉我怎么处理这个文件。",
      ].join("\n"));
      await setMessageReactionSafe(ctx, "👍");
      return;
    }

    const waiting = await ctx.reply(`文件已保存到 ${uploaded.savedPath}，机宝启动中...`);
    const answer = await opencode.prompt(caption, [uploaded]);
    await ctx.api.editMessageText(ctx.chat!.id, waiting.message_id, answer.message || "已处理。");
    if (answer.files.length > 0) {
      const sentFiles = await sendLocalFiles(ctx, config, answer.files);
      if (sentFiles.length > 0) {
        await logger.info(`sent files back to telegram: ${sentFiles.join(", ")}`);
      } else {
        await logger.warn(`file send failed for candidates: ${answer.files.join(", ")}`);
        await ctx.reply("我找到了相关文件，但这次发送失败了。");
      }
    }
    await setMessageReactionSafe(ctx, "👍");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logger.error(`file handling failed: ${message}`);
    await ctx.reply(`文件处理失败：${message}`);
    await setMessageReactionSafe(ctx, "👎");
  }
}

bot.on("callback_query:data", async (ctx) => {
  if (await handleReminderCallback(config, ctx)) {
    return;
  }

  const data = ctx.callbackQuery.data;
  if (!data.startsWith(MODEL_CALLBACK_PREFIX)) {
    await ctx.answerCallbackQuery();
    return;
  }

  const model = data.slice(MODEL_CALLBACK_PREFIX.length);
  try {
    const { models } = await opencode.listModels();
    if (!models.includes(model)) {
      await ctx.answerCallbackQuery({ text: "模型已不可用", show_alert: true });
      return;
    }
    state.model = model;
    await persistState();
    await ctx.answerCallbackQuery({ text: `已切换到 ${compactModelLabel(model)}` });
    if (ctx.chat && ctx.callbackQuery.message?.message_id) {
      await ctx.api.editMessageText(ctx.chat.id, ctx.callbackQuery.message.message_id, "请选择模型：", {
        reply_markup: buildModelKeyboard(models, state.model || model),
      });
    }
  } catch (error) {
    await ctx.answerCallbackQuery({ text: error instanceof Error ? error.message : String(error), show_alert: true });
  }
});

bot.on("message:text", handleIncomingText);
bot.on("message:document", handleIncomingFile);
bot.on("message:photo", handleIncomingFile);

await logger.info("Telegram bot starting");
const reminderLoop = await startReminderLoop(config, bot);
await bot.start({
  drop_pending_updates: false,
  onStart: async (botInfo) => {
    await bot.api.setMyCommands([
      { command: "help", description: "查看帮助和使用说明" },
      { command: "new", description: "新建会话" },
      { command: "model", description: "查看或切换模型" },
      { command: "reminders", description: "查看和管理提醒" },
    ]);
    await logger.info(`Telegram bot started as @${botInfo.username}`);
  },
});

process.on("SIGINT", () => {
  clearInterval(reminderLoop);
  opencode.stop();
  bot.stop();
});
process.on("SIGTERM", () => {
  clearInterval(reminderLoop);
  opencode.stop();
  bot.stop();
});
