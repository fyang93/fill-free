import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import { ReplyComposer } from "../src/support/ai/reply-composer";
import type { AppConfig } from "../src/scheduling/app/types";

function createTestConfig(): AppConfig {
  const repoRoot = path.join(os.tmpdir(), "defect-bot-startup-greeting-test");
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
      personaStyle: "模仿杀戮尖塔里的故障机器人说话。",
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

describe("startup greeting behavior", () => {
  test("startup greeting preserves configured persona-style output when it is displayable text", async () => {
    const composer = new ReplyComposer(
      createTestConfig(),
      async () => "",
      async () => "*系统错误* 检测到新的访客...欢迎回来。",
    );
    const message = await composer.generateStartupGreeting({ requesterUserId: 1, chatId: 1, chatType: "private" });
    expect(message).toContain("系统错误");
    expect(message).toContain("欢迎");
  });
});
