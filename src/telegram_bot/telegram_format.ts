import type { Bot, Context, InlineKeyboard } from "grammy";

type TelegramFormatOptions = {
  reply_markup?: InlineKeyboard;
  parse_mode?: "HTML";
};

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeHtmlAttribute(text: string): string {
  return escapeHtml(text).replaceAll("'", "&#39;");
}

function splitTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isTableSeparator(line: string): boolean {
  const normalized = line.trim().replace(/^\|/, "").replace(/\|$/, "").replaceAll(/[:\-\s|]/g, "");
  return normalized.length === 0 && /-/.test(line);
}

function isLikelyTableLine(line: string): boolean {
  return line.includes("|");
}

function padRight(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - text.length));
}

function renderTableBlock(lines: string[]): string | null {
  if (lines.length < 2 || !isTableSeparator(lines[1])) return null;
  const rows = [splitTableRow(lines[0]), ...lines.slice(2).map(splitTableRow)];
  const columnCount = Math.max(...rows.map((row) => row.length));
  const widths = Array.from({ length: columnCount }, (_, index) => {
    return Math.max(...rows.map((row) => (row[index] || "").length));
  });
  const rendered = rows.map((row, rowIndex) => {
    const line = widths.map((width, index) => padRight(row[index] || "", width)).join(" | ");
    if (rowIndex === 0) {
      const separator = widths.map((width) => "-".repeat(Math.max(3, width))).join("-+-");
      return `${line}\n${separator}`;
    }
    return line;
  }).join("\n");
  return `<pre>${escapeHtml(rendered)}</pre>`;
}

function applyInlineFormatting(text: string): string {
  const codeTokens: string[] = [];
  let next = text.replace(/`([^`]+)`/g, (_match, code) => {
    const token = `@@CODE${codeTokens.length}@@`;
    codeTokens.push(`<code>${escapeHtml(code)}</code>`);
    return token;
  });

  next = escapeHtml(next);
  next = next.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_match, label, url) => {
    return `<a href="${escapeHtmlAttribute(url)}">${escapeHtml(label)}</a>`;
  });
  next = next.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  next = next.replace(/__([^_]+)__/g, "<b>$1</b>");
  next = next.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,!?]|$)/g, "$1<i>$2</i>");
  next = next.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,!?]|$)/g, "$1<i>$2</i>");
  next = next.replace(/~~([^~]+)~~/g, "<s>$1</s>");

  for (let index = 0; index < codeTokens.length; index += 1) {
    next = next.replace(`@@CODE${index}@@`, codeTokens[index]);
  }
  return next;
}

function markdownToTelegramHtml(text: string): string {
  const normalized = text.replaceAll("\r\n", "\n");
  const lines = normalized.split("\n");
  const blocks: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    const fenceMatch = line.match(/^```([a-zA-Z0-9_-]+)?\s*$/);
    if (fenceMatch) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }
      blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    if (isLikelyTableLine(line) && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
      const tableLines = [line, lines[index + 1]];
      let cursor = index + 2;
      while (cursor < lines.length && isLikelyTableLine(lines[cursor])) {
        tableLines.push(lines[cursor]);
        cursor += 1;
      }
      const renderedTable = renderTableBlock(tableLines);
      if (renderedTable) {
        blocks.push(renderedTable);
        index = cursor - 1;
        continue;
      }
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      blocks.push(`<b>${applyInlineFormatting(headingMatch[2].trim())}</b>`);
      continue;
    }

    if (line.trim().length === 0) {
      blocks.push("");
      continue;
    }

    blocks.push(applyInlineFormatting(line));
  }

  return blocks.join("\n");
}

async function withTelegramFormattingFallback<T>(
  send: (text: string, options?: TelegramFormatOptions) => Promise<T>,
  text: string,
  options?: Omit<TelegramFormatOptions, "parse_mode">,
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
  return withTelegramFormattingFallback((nextText, nextOptions) => ctx.reply(nextText, nextOptions), text, options);
}

export async function editMessageTextFormatted(
  ctx: Context,
  chatId: number,
  messageId: number,
  text: string,
  options?: { reply_markup?: InlineKeyboard },
): Promise<unknown> {
  return withTelegramFormattingFallback(
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
  return withTelegramFormattingFallback(
    (nextText, nextOptions) => bot.api.sendMessage(chatId, nextText, nextOptions),
    text,
    options,
  );
}
