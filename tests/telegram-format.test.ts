import { describe, expect, test } from "bun:test";
import { markdownToTelegramHtml } from "../src/bot/telegram/format";

describe("telegram markdown formatting", () => {
  test("horizontal rule stays a visible separator instead of a code block", () => {
    const html = markdownToTelegramHtml("上半段\n\n------------------------\n\n下半段");
    expect(html).toContain("上半段");
    expect(html).toContain("下半段");
    expect(html).toContain("────────────────────────");
    expect(html).not.toContain("<pre>");
    expect(html).not.toContain("<code>");
  });
});
