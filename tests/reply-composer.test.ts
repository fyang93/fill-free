import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { ReplyComposer } from "../src/support/ai/reply-composer";
import type { AppConfig } from "../src/scheduling/app/types";

function createTestConfig(): AppConfig {
  const repoRoot = path.join(os.tmpdir(), "defect-bot-reply-composer-test");
  return {
    telegram: {
      botToken: "test",
      adminUserId: 1,
      waitingMessage: "",
      waitingMessageCandidates: [],
      waitingMessageRotationSeconds: 0,
      menuPageSize: 10,
    },
    bot: {
      personaStyle: "冷静、简洁、稳定",
      language: "zh",
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
  test("generateReminderMessage requests persona-aware reminder wording", async () => {
    let captured = "";
    const composer = new ReplyComposer(createTestConfig(), async (prompt) => {
      captured = prompt;
      return "18:00，记得 review 论文。";
    });
    await composer.generateReminderMessage("review论文", "2026-04-05T18:00:00", "一次性提醒");
    expect(captured).toContain("Reply style: 冷静、简洁、稳定");
    expect(captured).toContain("Keep the configured persona visible in the wording, but restrained.");
  });

  test("startup greeting request keeps persona enabled", async () => {
    let captured = "";
    const composer = new ReplyComposer(createTestConfig(), async () => "", async (prompt) => {
      captured = prompt;
      return "系统错误...欢迎回来。";
    });
    await composer.generateStartupGreeting({ requesterUserId: 1, chatId: 1, chatType: "private" });
    expect(captured).toContain("Reply style: 冷静、简洁、稳定");
  });

  test("generateReminderMessage rejects tool-call markup and returns empty string", async () => {
    const composer = new ReplyComposer(createTestConfig(), async () => '<invoke name="memory"><parameter name="query">x</parameter></invoke></minimax:tool_call>');
    const message = await composer.generateReminderMessage("review论文", "2026-04-05T18:00:00", "一次性提醒");
    expect(message).toBe("");
  });

  test("composeUserReply falls back to clean draft when model returns tool-call markup", async () => {
    const composer = new ReplyComposer(createTestConfig(), async () => '<invoke name="memory"><parameter name="query">x</parameter></invoke></minimax:tool_call>');
    const message = await composer.composeUserReply("好的，18:00 提醒你 review 论文。", [], { requesterUserId: 1, chatId: 1, chatType: "private" });
    expect(message).toBe("好的，18:00 提醒你 review 论文。");
  });

  test("startup greeting returns null when model emits non-displayable markup", async () => {
    const composer = new ReplyComposer(createTestConfig(), async () => "", async () => '<invoke name="memory"><parameter name="query">x</parameter></invoke></minimax:tool_call>');
    const message = await composer.generateStartupGreeting({ requesterUserId: 1, chatId: 1, chatType: "private" });
    expect(message).toBeNull();
  });

  test("startup greeting returns null when model leaks hidden tag markup before visible text", async () => {
    const composer = new ReplyComposer(
      createTestConfig(),
      async () => "",
      async () => '<hidden-note>use chinese persona</hidden-note>\n\n你好，羊帆。系统初始化中。',
    );
    const message = await composer.generateStartupGreeting({ requesterUserId: 1, chatId: 1, chatType: "private" });
    expect(message).toBeNull();
  });
});
