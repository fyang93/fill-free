import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/bot/app/types";
import { extractCandidateFilePaths } from "../src/bot/telegram/transport";
import { deliverAiOutputs } from "../src/bot/runtime/conversations/output";

function createTestConfig(repoRoot: string): AppConfig {
  return {
    telegram: {
      botToken: "test",
      adminUserId: 1,
      waitingMessage: "",
      runtimeAckDelaySeconds: 5,
      runtimeProgressDelaySeconds: 15,
      inputMergeWindowSeconds: 3,
      menuPageSize: 8,
      inputMergeWindowSeconds: 3,
    },
    bot: {
      personaStyle: "",
      language: "zh-CN",
      defaultTimezone: "Asia/Tokyo",
    },
    paths: {
      repoRoot,
      tmpDir: path.join(repoRoot, "tmp"),
      uploadSubdir: "telegram",
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

describe("telegram current-turn output", () => {
  test("extractCandidateFilePaths resolves markdown relative memory links", () => {
    expect(extractCandidateFilePaths("照片在这里：[锅巴照片](../memory/shared/households/yang-fan-family/guoba.jpg)")).toEqual(["memory/shared/households/yang-fan-family/guoba.jpg"]);
  });

  test("deliverAiOutputs sends current-chat image through shared telegram delivery path", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "defect-bot-output-test-"));
    try {
      await mkdir(path.join(repoRoot, "memory", "shared", "households", "yang-fan-family"), { recursive: true });
      await writeFile(path.join(repoRoot, "memory", "shared", "households", "yang-fan-family", "guoba.jpg"), "fake-jpg", "utf8");
      const config = createTestConfig(repoRoot);
      const calls: string[] = [];
      const ctx = {
        chat: { id: 42, type: "private" },
        from: { id: 1 },
        api: {
          sendPhoto: async (chatId: number) => {
            calls.push(`sendPhoto:${chatId}`);
            return { message_id: 99 };
          },
          sendVoice: async () => {
            calls.push("sendVoice");
            return { message_id: 1 };
          },
          sendVideo: async () => {
            calls.push("sendVideo");
            return { message_id: 1 };
          },
          sendAudio: async () => {
            calls.push("sendAudio");
            return { message_id: 1 };
          },
          sendDocument: async () => {
            calls.push("sendDocument");
            return { message_id: 1 };
          },
        },
        reply: async (text: string) => {
          calls.push(`reply:${text}`);
          return { message_id: 100 };
        },
      } as any;

      await deliverAiOutputs(ctx, config, {
        message: "这是锅巴的照片：[锅巴照片](../memory/shared/households/yang-fan-family/guoba.jpg)",
        answerMode: "needs-execution",
        files: [],
        attachments: [],
        fileWrites: [],
        schedules: [],
        deliveries: [],
        pendingAuthorizations: [],
        tasks: [],
      });

      expect(calls).toContain("sendPhoto:42");
      expect(calls.some((entry) => entry.startsWith("reply:"))).toBe(false);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
