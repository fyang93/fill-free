import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/scheduling/app/types";
import { buildResponderContextBlock } from "../src/operations/context/responder";
import { clearRecentClarification, state, rememberRecentClarification } from "../src/scheduling/app/state";

const tempDirs: string[] = [];

function createTestConfig(repoRoot: string): AppConfig {
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
      personaStyle: "",
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

async function createTempConfig(): Promise<AppConfig> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "defect-bot-responder-context-"));
  tempDirs.push(repoRoot);
  await mkdir(path.join(repoRoot, "system"), { recursive: true });
  await writeFile(path.join(repoRoot, "system", "users.json"), '{"users":{"1":{"displayName":"Admin Test","timezone":"Asia/Tokyo"}}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "chats.json"), '{"chats":{"1":{"type":"private","title":"Admin Chat"}}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "rules.json"), '{"rules":[]}\n', "utf8");
  return createTestConfig(repoRoot);
}

afterEach(async () => {
  clearRecentClarification();
  state.telegramUserCache = {};
  state.telegramChatCache = {};
  state.userTimezoneCache = {};
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("responder clarification context", () => {
  test("recent clarification is injected into responder context for the next private-scope turn", async () => {
    const config = await createTempConfig();
    rememberRecentClarification("user:1", "下午提醒我review论文", "好的，下午几点提醒你呢？");

    const context = await buildResponderContextBlock(config, {
      requesterUserId: 1,
      chatId: 1,
      messageTime: "2026-04-05T16:51:25.000Z",
      indexContext: { matchedTerms: [], paths: [] },
    });

    expect(context).toContain('"recentClarification"');
    expect(context).toContain("下午提醒我review论文");
    expect(context).toContain("下午几点提醒你呢");
    expect(context).toContain('"turnTime"');
    expect(context).toContain('"localDate": "2026-04-06"');
  });

  test("clearing recent clarification removes it from responder context", async () => {
    const config = await createTempConfig();
    rememberRecentClarification("user:1", "下午提醒我review论文", "好的，下午几点提醒你呢？");
    clearRecentClarification("user:1");

    const context = await buildResponderContextBlock(config, {
      requesterUserId: 1,
      chatId: 1,
      messageTime: "2026-04-05T16:51:25.000Z",
      indexContext: { matchedTerms: [], paths: [] },
    });

    expect(context).toContain('"recentClarification": null');
    expect(context).toContain('"turnTime"');
  });
});
