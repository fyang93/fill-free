import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { ReplyComposer } from "../src/bot/ai/reply-composer";
import type { AppConfig } from "../src/bot/app/types";

function createTestConfig(): AppConfig {
  const repoRoot = path.join(os.tmpdir(), "defect-bot-reply-composer-test");
  return {
    telegram: {
      botToken: "test",
      adminUserId: 1,
      waitingMessage: "",
      runtimeAckDelaySeconds: 5,
      runtimeProgressDelaySeconds: 15,
      inputMergeWindowSeconds: 3,
      menuPageSize: 10,
    },
    bot: {
      personaStyle: "冷静、简洁、稳定",
      language: "zh-CN",
      defaultTimezone: "Asia/Tokyo",
    },
    paths: {
      repoRoot,
      tmpDir: path.join(repoRoot, "tmp"),
      uploadSubdir: "uploads",
      logFile: path.join(repoRoot, "logs", "bot.log"),
      stateFile: path.join(repoRoot, "system", "state.json"),
    },
    maintenance: {
      enabled: false,
      idleAfterMs: 0,
      tmpRetentionDays: 1,
    },
    opencode: {
      baseUrl: "http://127.0.0.1:4096",
    },
  };
}

describe("reply composer sanitization", () => {
  test("generateScheduleMessage requests persona-aware schedule wording", async () => {
    let captured = "";
    const composer = new ReplyComposer(createTestConfig(), async (prompt) => {
      captured = prompt;
      return "18:00，记得 review 论文。";
    });
    await composer.generateScheduleMessage("review论文", "2026-04-05T18:00:00", "一次性提醒");
    expect(captured).toContain("Reply style: 冷静、简洁、稳定");
    expect(captured).toContain("Style for Telegram replies: 冷静、简洁、稳定");
    expect(captured).toContain("Answer the user directly.");
    expect(captured).toContain("Use the configured persona strongly and explicitly in the visible wording.");
    expect(captured).toContain("Whenever the visible reply mentions a concrete time, date-time, or local clock time, include the timezone explicitly.");
    expect(captured).toContain("Write a short, clear schedule message.");
  });

  test("startup greeting request keeps persona enabled", async () => {
    let captured = "";
    const composer = new ReplyComposer(createTestConfig(), async () => "", async (prompt) => {
      captured = prompt;
      return "系统错误...欢迎回来。";
    });
    await composer.generateStartupGreeting({ requesterUserId: 1, chatId: 1, chatType: "private" });
    expect(captured).toContain("Write one short proactive startup greeting for the administrator.");
    expect(captured).toContain("Return only the greeting text. Do not send it and do not take any action.");
    expect(captured).toContain("Reply style: 冷静、简洁、稳定");
    expect(captured).toContain("Style for Telegram replies: 冷静、简洁、稳定");
    expect(captured).toContain("Use the configured persona strongly and explicitly in the visible wording.");
  });

  test("generateRuntimeAckMessage requests persona-aware current-turn wording", async () => {
    let captured = "";
    const composer = new ReplyComposer(createTestConfig(), async (prompt) => {
      captured = prompt;
      return "收到...处理中。";
    });
    await composer.generateRuntimeAckMessage("initial", { preferredLanguage: "zh-CN" });
    expect(captured).toContain("Reply style: 冷静、简洁、稳定");
    expect(captured).toContain("The assistant has started working on the current request.");
    expect(captured).toContain("Write one very short current-turn acknowledgment for the requester.");
    expect(captured).toContain("Use the configured persona strongly and explicitly in the visible wording.");
    expect(captured).toContain("Whenever the visible reply mentions a concrete time, date-time, or local clock time, include the timezone explicitly.");
    expect(captured).toContain("Use this language for the reply: zh-CN.");
  });

  test("generateScheduleMessage rejects tool-call markup and returns empty string", async () => {
    const composer = new ReplyComposer(createTestConfig(), async () => '<invoke name="memory"><parameter name="query">x</parameter></invoke></minimax:tool_call>');
    const message = await composer.generateScheduleMessage("review论文", "2026-04-05T18:00:00", "一次性提醒");
    expect(message).toBe("");
  });

  test("composeUserReply falls back to clean draft when model returns tool-call markup", async () => {
    const composer = new ReplyComposer(createTestConfig(), async () => '<invoke name="memory"><parameter name="query">x</parameter></invoke></minimax:tool_call>');
    const message = await composer.composeUserReply("好的，18:00 提醒你 review 论文。", [], { requesterUserId: 1, chatId: 1, chatType: "private" });
    expect(message).toBe("好的，18:00 提醒你 review 论文。");
  });

  test("startup greeting rejects tool-call markup", async () => {
    const composer = new ReplyComposer(createTestConfig(), async () => "", async () => '<invoke name="memory"><parameter name="query">x</parameter></invoke></minimax:tool_call>');
    const message = await composer.generateStartupGreeting({ requesterUserId: 1 });
    expect(message).toBeNull();
  });

  test("startup greeting rejects hidden-like tags before visible text", async () => {
    const composer = new ReplyComposer(
      createTestConfig(),
      async () => "",
      async () => '<hidden-note>use chinese persona</hidden-note>\n\n你好，羊帆。系统初始化中。',
    );
    const message = await composer.generateStartupGreeting({ requesterUserId: 1 });
    expect(message).toBeNull();
  });
});
