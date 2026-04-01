import type { Bot, Context, InlineKeyboard } from "grammy";

type TelegramFormatOptions = {
  reply_markup?: InlineKeyboard;
  parse_mode?: "Markdown";
};

async function withMarkdownFallback<T>(
  send: (text: string, options?: TelegramFormatOptions) => Promise<T>,
  text: string,
  options?: Omit<TelegramFormatOptions, "parse_mode">,
): Promise<T> {
  try {
    return await send(text, { ...(options || {}), parse_mode: "Markdown" });
  } catch {
    return send(text, options);
  }
}

export async function replyFormatted(
  ctx: Context,
  text: string,
  options?: { reply_markup?: InlineKeyboard },
): Promise<unknown> {
  return withMarkdownFallback((nextText, nextOptions) => ctx.reply(nextText, nextOptions), text, options);
}

export async function editMessageTextFormatted(
  ctx: Context,
  chatId: number,
  messageId: number,
  text: string,
  options?: { reply_markup?: InlineKeyboard },
): Promise<unknown> {
  return withMarkdownFallback(
    (nextText, nextOptions) => ctx.api.editMessageText(chatId, messageId, nextText, nextOptions),
    text,
    options,
  );
}

export async function sendMessageFormatted(
  bot: Bot<Context>,
  chatId: number,
  text: string,
  options?: { reply_markup?: InlineKeyboard },
): Promise<unknown> {
  return withMarkdownFallback(
    (nextText, nextOptions) => bot.api.sendMessage(chatId, nextText, nextOptions),
    text,
    options,
  );
}
