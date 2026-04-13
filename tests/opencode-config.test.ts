import { describe, expect, test } from "bun:test";
import { buildProjectSystemPrompt } from "../src/bot/ai/prompt";

describe("role prompts stay aligned with current routing design", () => {
  test("assistant prompt stays narrow", () => {
    const assistant = buildProjectSystemPrompt("简洁", "assistant");

    expect(assistant).toContain("You are the main assistant for a local-first Telegram bot.");
    expect(assistant).toContain("Return one final user-visible reply for this turn after completing the needed work.");
  });
});
