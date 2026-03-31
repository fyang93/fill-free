import type { Bot, Context, InlineKeyboard } from "grammy";

async function withMarkdownFallback<T>(
  send: (text: string, options?: Record<string, unknown>) => Promise<T>,
  text: string,
  options?: Record<string, unknown>,
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
  return withMarkdownFallback((nextText, nextOptions) => ctx.reply(nextText, nextOptions as any), text, options as Record<string, unknown> | undefined);
}

export async function editMessageTextFormatted(
  ctx: Context,
  chatId: number,
  messageId: number,
  text: string,
  options?: { reply_markup?: InlineKeyboard },
): Promise<unknown> {
  return withMarkdownFallback(
    (nextText, nextOptions) => ctx.api.editMessageText(chatId, messageId, nextText, nextOptions as any),
    text,
    options as Record<string, unknown> | undefined,
  );
}

export async function sendMessageFormatted(
  bot: Bot<Context>,
  chatId: number,
  text: string,
  options?: { reply_markup?: InlineKeyboard },
): Promise<unknown> {
  return withMarkdownFallback(
    (nextText, nextOptions) => bot.api.sendMessage(chatId, nextText, nextOptions as any),
    text,
    options as Record<string, unknown> | undefined,
  );
}
