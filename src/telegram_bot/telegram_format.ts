import type { Bot, Context, InlineKeyboard } from "grammy";

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function restorePlaceholders(text: string, placeholders: Map<string, string>): string {
  let result = text;
  for (const [key, value] of placeholders.entries()) {
    result = result.replaceAll(key, value);
  }
  return result;
}

export function markdownToTelegramHtml(markdown: string): string {
  const fencedBlocks = new Map<string, string>();
  let text = markdown.replace(/```([\w+-]+)?\n([\s\S]*?)```/g, (_match, language: string | undefined, code: string) => {
    const key = `__TG_FENCE_${fencedBlocks.size}__`;
    const escapedCode = escapeHtml(code.replace(/\n$/, ""));
    const langAttr = language ? ` class=\"language-${escapeHtml(language)}\"` : "";
    fencedBlocks.set(key, `<pre><code${langAttr}>${escapedCode}</code></pre>`);
    return key;
  });

  const inlineCodes = new Map<string, string>();
  text = text.replace(/`([^`\n]+)`/g, (_match, code: string) => {
    const key = `__TG_CODE_${inlineCodes.size}__`;
    inlineCodes.set(key, `<code>${escapeHtml(code)}</code>`);
    return key;
  });

  text = escapeHtml(text);
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label: string, url: string) => `<a href="${escapeHtml(url)}">${label}</a>`);
  text = text.replace(/\*\*([^*\n][\s\S]*?[^*\n])\*\*/g, "<b>$1</b>");
  text = text.replace(/__([^_\n][\s\S]*?[^_\n])__/g, "<b>$1</b>");
  text = text.replace(/(^|[\s(])\*([^*\n][\s\S]*?[^*\n])\*(?=[\s),.!?:;]|$)/g, "$1<i>$2</i>");
  text = text.replace(/(^|[\s(])_([^_\n][\s\S]*?[^_\n])_(?=[\s),.!?:;]|$)/g, "$1<i>$2</i>");
  text = text.replace(/~~([^~\n][\s\S]*?[^~\n])~~/g, "<s>$1</s>");

  text = restorePlaceholders(text, inlineCodes);
  text = restorePlaceholders(text, fencedBlocks);
  return text;
}

async function withHtmlFallback<T>(
  send: (text: string, options?: Record<string, unknown>) => Promise<T>,
  text: string,
  options?: Record<string, unknown>,
): Promise<T> {
  try {
    return await send(markdownToTelegramHtml(text), { ...(options || {}), parse_mode: "HTML" });
  } catch {
    return send(text, options);
  }
}

export async function replyFormatted(
  ctx: Context,
  text: string,
  options?: { reply_markup?: InlineKeyboard },
): Promise<unknown> {
  return withHtmlFallback((nextText, nextOptions) => ctx.reply(nextText, nextOptions as any), text, options as Record<string, unknown> | undefined);
}

export async function editMessageTextFormatted(
  ctx: Context,
  chatId: number,
  messageId: number,
  text: string,
  options?: { reply_markup?: InlineKeyboard },
): Promise<unknown> {
  return withHtmlFallback(
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
  return withHtmlFallback(
    (nextText, nextOptions) => bot.api.sendMessage(chatId, nextText, nextOptions as any),
    text,
    options as Record<string, unknown> | undefined,
  );
}
