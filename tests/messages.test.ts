import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/scheduling/app/types";
import { executeAiActions } from "../src/roles/executor";
import { dequeueRunnableTask, markTaskState, removeTask } from "../src/support/tasks/runtime/store";
import { runTaskWithHandlers } from "../src/support/tasks/runtime/handlers";
import { rememberTelegramChat } from "../src/interaction/telegram/registry";

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

async function createTempConfig(): Promise<{ config: AppConfig; repoRoot: string }> {
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "defect-bot-messages-test-"));
  await mkdir(path.join(repoRoot, "system"), { recursive: true });
  await writeFile(path.join(repoRoot, "system", "users.json"), '{"users":{}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "chats.json"), '{"chats":{}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "rules.json"), '{"rules":[]}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "tasks.json"), '{"tasks":[]}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "state.json"), '{}\n', "utf8");
  process.chdir(repoRoot);
  return { config: createTestConfig(repoRoot), repoRoot };
}

describe("message delivery flow", () => {
  test("executor queues canonical messages.deliver task with payload.content and handler sends it", async () => {
    const { config, repoRoot } = await createTempConfig();
    try {
      const sent: Array<{ chatId: number; text: string }> = [];
      rememberTelegramChat({ id: -1003674455331, type: "supergroup", title: "锅巴之家" }, [872940661]);
      const agentService = {
        planExecutorActions: async () => ({
          message: "已发送测试消息到锅巴之家",
          answerMode: "direct",
          files: [],
          fileWrites: [],
          attachments: [],
          reminders: [],
          deliveries: [{ content: "测试消息", recipient: { id: -1003674455331 } }],
          pendingAuthorizations: [],
          tasks: [],
        }),
        composeDeliveryMessage: async (baseMessage: string) => baseMessage,
      } as any;

      await executeAiActions({
        config,
        agentService,
        answer: {
          message: "正在发送测试消息到锅巴之家群...",
          answerMode: "needs-execution",
          files: [],
          fileWrites: [],
          attachments: [],
          reminders: [],
          deliveries: [],
          pendingAuthorizations: [],
          tasks: [],
        },
        ctx: { chat: { id: 872940661, type: "private" }, message: { message_id: 1827, text: "发送测试消息到锅巴之家" } } as any,
        requesterUserId: 872940661,
        canDeliverOutbound: true,
        accessRole: "admin",
        userRequestText: "发送测试消息到锅巴之家",
        isTaskCurrent: () => true,
      });

      const queuedTask = await dequeueRunnableTask(config);
      expect(queuedTask?.domain).toBe("messages");
      expect(queuedTask?.operation).toBe("deliver");
      expect(queuedTask?.payload.content).toBe("测试消息");
      expect(queuedTask?.payload.recipientId).toBe(-1003674455331);

      const output = await runTaskWithHandlers(
        {
          config,
          agentService,
          bot: { api: { sendMessage: async (chatId: number, text: string) => { sent.push({ chatId, text }); return {}; } } } as any,
        },
        queuedTask!,
      );
      expect(output.result?.delivered).toBe(true);
      expect(sent).toEqual([{ chatId: -1003674455331, text: "测试消息" }]);

      await markTaskState(config, queuedTask!.id, "done", { result: output.result || {} });
      await removeTask(config, queuedTask!.id);

      const tasksDoc = JSON.parse(await readFile(path.join(repoRoot, "system", "tasks.json"), "utf8")) as { tasks?: unknown[] };
      expect(tasksDoc.tasks).toEqual([]);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
