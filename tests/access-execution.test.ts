import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/bot/app/types";
import { executeAssistantActions } from "../src/bot/runtime/assistant-actions";
import { rememberTelegramUser } from "../src/bot/telegram/registry";
import { ensureAdminUserAccessLevel, setStoredUserAccessLevel } from "../src/bot/operations/access/roles";

function createTestConfig(repoRoot: string): AppConfig {
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
      personaStyle: "",
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

async function createTempConfig(): Promise<{ config: AppConfig; repoRoot: string; originalCwd: string }> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "defect-bot-access-exec-"));
  await mkdir(path.join(repoRoot, "system"), { recursive: true });
  await writeFile(path.join(repoRoot, "system", "users.json"), '{"users":{}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "chats.json"), '{"chats":{}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "tasks.json"), '{"tasks":[]}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "state.json"), '{}\n', "utf8");
  const originalCwd = process.cwd();
  process.chdir(repoRoot);
  return { config: createTestConfig(repoRoot), repoRoot, originalCwd };
}

describe("access execution", () => {
  test("admin access level is derived from config and synced into users.json", async () => {
    const { config, repoRoot, originalCwd } = await createTempConfig();
    try {
      const changed = await ensureAdminUserAccessLevel(config);
      expect(changed).toBe(true);
      const usersDoc = JSON.parse(await readFile(path.join(repoRoot, "system", "users.json"), "utf8")) as { users?: Record<string, Record<string, unknown>> };
      expect(usersDoc.users?.["1"]?.accessLevel).toBe("admin");
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("executeAssistantActions keeps assistant inputs text-first instead of forcing raw attachments into the model call", async () => {
    const { config, repoRoot, originalCwd } = await createTempConfig();
    try {
      let captured: Record<string, unknown> | null = null;

      await executeAssistantActions({
        config,
        agentService: {
          runAssistantTurn: async (input: any) => {
            captured = input;
            return {
              message: "看到了文件。",
              answerMode: "direct",
              usedNativeExecution: false,
              completedActions: [],
            };
          },
        } as any,
        ctx: { chat: { id: 1, type: "private" }, message: { message_id: 1, text: "你怎么看" } } as any,
        requesterUserId: 1,
        canDeliverOutbound: true,
        accessRole: "admin",
        userRequestText: "你怎么看\n\nSaved files:\n- tmp/example.jpg (image/jpeg, 1 KB)",
        isTaskCurrent: () => true,
      });

      expect(captured?.uploadedFiles).toEqual([]);
      expect(captured?.attachments).toEqual([]);
      expect(String(captured?.userRequestText || "")).toContain("Saved files:");
      expect(String(captured?.userRequestText || "")).toContain("tmp/example.jpg");
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("access.set-access-level is applied immediately without queueing a task", async () => {
    const { config, repoRoot, originalCwd } = await createTempConfig();
    try {
      rememberTelegramUser({ id: 8631425224, username: "test_rain", first_name: "测试", last_name: "雨" });

      await executeAssistantActions({
        config,
        agentService: {
          runAssistantTurn: async () => {
            await setStoredUserAccessLevel(config, 8631425224, "trusted", { username: "test_rain" });
            return {
              message: "好的，已把 test_rain 设为 trusted。",
              answerMode: "needs-execution",
              usedNativeExecution: true,
              completedActions: ["users:set-access"],
            };
          },
        } as any,
        ctx: { chat: { id: 1, type: "private" }, message: { message_id: 1, text: "把 test_rain 设为 trusted" } } as any,
        requesterUserId: 1,
        canDeliverOutbound: true,
        accessRole: "admin",
        userRequestText: "把 test_rain 设为 trusted",
        isTaskCurrent: () => true,
      });

      const usersDoc = JSON.parse(await readFile(path.join(repoRoot, "system", "users.json"), "utf8")) as { users?: Record<string, Record<string, unknown>> };
      expect(usersDoc.users?.["8631425224"]?.accessLevel).toBe("trusted");

      const tasksDoc = JSON.parse(await readFile(path.join(repoRoot, "system", "tasks.json"), "utf8")) as { tasks?: unknown[] };
      expect(tasksDoc.tasks).toEqual([]);
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
