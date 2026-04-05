import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/scheduling/app/types";
import { publishResponderFirstReply, runConversationTask, type ActiveConversationTask } from "../src/roles/responder";
import { clearRecentClarification, state } from "../src/scheduling/app/state";

const tempDirs: string[] = [];

function createTestConfig(repoRoot: string): AppConfig {
  return {
    telegram: {
      botToken: "test",
      adminUserId: 1,
      waitingMessage: "",
      waitingMessageCandidates: [],
      waitingMessageRotationSeconds: 0,
      inputMergeWindowSeconds: 3,
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
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "defect-bot-responder-"));
  tempDirs.push(repoRoot);
  await mkdir(path.join(repoRoot, "system"), { recursive: true });
  await writeFile(path.join(repoRoot, "system", "users.json"), '{"users":{"1":{"displayName":"Admin Test","timezone":"Asia/Tokyo"}}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "chats.json"), '{"chats":{"1":{"type":"private","title":"Admin Chat"}}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "rules.json"), '{"rules":[]}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "reminders.json"), '[]\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "inverted-index.json"), '{"terms":{}}\n', "utf8");
  return createTestConfig(repoRoot);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(async () => {
  clearRecentClarification();
  state.telegramUserCache = {};
  state.telegramChatCache = {};
  state.userTimezoneCache = {};
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("responder first reply delivery", () => {
  test("sends the responder reply as a new message before removing the waiting placeholder", async () => {
    const calls: string[] = [];
    const ctx = {
      reply: async (text: string) => {
        calls.push(`reply:${text}`);
        return { message_id: 2 };
      },
      api: {
        deleteMessage: async (chatId: number, messageId: number) => {
          calls.push(`delete:${chatId}:${messageId}`);
        },
      },
    } as any;

    const task: ActiveConversationTask = {
      id: 1,
      scopeKey: "user:1",
      scopeLabel: "user:1",
      chatId: 1,
      sourceMessageId: 10,
      waitingMessageId: 11,
      cancelled: false,
    };

    await publishResponderFirstReply(ctx, task, "好的，今天 21:00 提醒你。\n");

    expect(calls).toEqual([
      "reply:好的，今天 21:00 提醒你。\n",
      "delete:1:11",
    ]);
  });

  test("still sends the responder reply when there is no waiting placeholder", async () => {
    const calls: string[] = [];
    const ctx = {
      reply: async (text: string) => {
        calls.push(`reply:${text}`);
        return { message_id: 2 };
      },
      api: {
        deleteMessage: async (_chatId: number, _messageId: number) => {
          calls.push("delete");
        },
      },
    } as any;

    const task: ActiveConversationTask = {
      id: 1,
      scopeKey: "user:1",
      scopeLabel: "user:1",
      chatId: 1,
      sourceMessageId: 10,
      cancelled: false,
    };

    await publishResponderFirstReply(ctx, task, "收到");

    expect(calls).toEqual(["reply:收到"]);
  });
});

describe("conversation race orchestration", () => {
  test("fast direct reply wins and no slow reply is published", async () => {
    const config = await createTempConfig();
    const calls: string[] = [];
    const ctx = {
      chat: { id: 1, type: "private" },
      from: { id: 1 },
      message: { message_id: 10, text: "今天天气怎么样" },
      reply: async (text: string) => {
        calls.push(`reply:${text}`);
        return { message_id: 2 };
      },
      api: {
        deleteMessage: async (chatId: number, messageId: number) => {
          calls.push(`delete:${chatId}:${messageId}`);
        },
      },
    } as any;
    const task: ActiveConversationTask = {
      id: 1,
      userId: 1,
      scopeKey: "user:1",
      scopeLabel: "user:1",
      chatId: 1,
      sourceMessageId: 10,
      waitingMessageId: 11,
      cancelled: false,
    };
    const released: string[] = [];
    const agentService = {
      prompt: async () => {
        await delay(5);
        return { message: "快答", answerMode: "direct", files: [], fileWrites: [], attachments: [], reminders: [], deliveries: [], pendingAuthorizations: [], tasks: [] };
      },
      planExecutorActions: async () => {
        await delay(50);
        return { message: "慢答", answerMode: "direct", files: [], fileWrites: [], attachments: [], reminders: [], deliveries: [], pendingAuthorizations: [], tasks: [] };
      },
    } as any;

    await runConversationTask({
      config,
      ctx,
      task,
      promptText: "今天天气怎么样",
      uploadedFiles: [],
      attachments: [],
      messageTime: "2026-04-06T00:00:00.000Z",
      agentService,
      isAdminUserId: () => true,
      isTrustedUserId: () => true,
      isTaskCurrent: () => true,
      onPruneRecentUploads: async () => {},
      onStopWaiting: () => {},
      onSetReaction: async () => {},
      onReleaseActiveTask: (scopeKey, taskId) => released.push(`${scopeKey}:${taskId}`),
    });
    await delay(80);

    expect(calls).toEqual([
      "reply:快答",
      "delete:1:11",
    ]);
    expect(released).toEqual(["user:1:1"]);
  });

  test("fast pre-execution reply is followed by slow final reply", async () => {
    const config = await createTempConfig();
    const calls: string[] = [];
    const ctx = {
      chat: { id: 1, type: "private" },
      from: { id: 1 },
      message: { message_id: 10, text: "帮我处理这件事" },
      reply: async (text: string) => {
        calls.push(`reply:${text}`);
        return { message_id: 2 };
      },
      api: {
        deleteMessage: async (chatId: number, messageId: number) => {
          calls.push(`delete:${chatId}:${messageId}`);
        },
      },
    } as any;
    const task: ActiveConversationTask = {
      id: 1,
      userId: 1,
      scopeKey: "user:1",
      scopeLabel: "user:1",
      chatId: 1,
      sourceMessageId: 10,
      waitingMessageId: 11,
      cancelled: false,
    };
    const agentService = {
      prompt: async () => {
        await delay(5);
        return { message: "先处理", answerMode: "needs-execution", files: [], fileWrites: [], attachments: [], reminders: [], deliveries: [], pendingAuthorizations: [], tasks: [] };
      },
      planExecutorActions: async () => {
        await delay(30);
        return { message: "最终完成", answerMode: "needs-execution", files: [], fileWrites: [], attachments: [], reminders: [], deliveries: [], pendingAuthorizations: [], tasks: [] };
      },
    } as any;

    await runConversationTask({
      config,
      ctx,
      task,
      promptText: "帮我处理这件事",
      uploadedFiles: [],
      attachments: [],
      messageTime: "2026-04-06T00:00:00.000Z",
      agentService,
      isAdminUserId: () => true,
      isTrustedUserId: () => true,
      isTaskCurrent: () => true,
      onPruneRecentUploads: async () => {},
      onStopWaiting: () => {},
      onSetReaction: async () => {},
      onReleaseActiveTask: () => {},
    });

    expect(calls).toEqual([
      "reply:先处理",
      "delete:1:11",
      "reply:最终完成",
    ]);
  });

  test("slow direct result can win the race and be published immediately", async () => {
    const config = await createTempConfig();
    const calls: string[] = [];
    const ctx = {
      chat: { id: 1, type: "private" },
      from: { id: 1 },
      message: { message_id: 10, text: "直接回答" },
      reply: async (text: string) => {
        calls.push(`reply:${text}`);
        return { message_id: 2 };
      },
      api: {
        deleteMessage: async (chatId: number, messageId: number) => {
          calls.push(`delete:${chatId}:${messageId}`);
        },
      },
    } as any;
    const task: ActiveConversationTask = {
      id: 1,
      userId: 1,
      scopeKey: "user:1",
      scopeLabel: "user:1",
      chatId: 1,
      sourceMessageId: 10,
      waitingMessageId: 11,
      cancelled: false,
    };
    const agentService = {
      prompt: async () => {
        await delay(40);
        return { message: "快答较慢", answerMode: "direct", files: [], fileWrites: [], attachments: [], reminders: [], deliveries: [], pendingAuthorizations: [], tasks: [] };
      },
      planExecutorActions: async () => {
        await delay(5);
        return { message: "慢路先完成", answerMode: "direct", files: [], fileWrites: [], attachments: [], reminders: [], deliveries: [], pendingAuthorizations: [], tasks: [] };
      },
    } as any;

    await runConversationTask({
      config,
      ctx,
      task,
      promptText: "直接回答",
      uploadedFiles: [],
      attachments: [],
      messageTime: "2026-04-06T00:00:00.000Z",
      agentService,
      isAdminUserId: () => true,
      isTrustedUserId: () => true,
      isTaskCurrent: () => true,
      onPruneRecentUploads: async () => {},
      onStopWaiting: () => {},
      onSetReaction: async () => {},
      onReleaseActiveTask: () => {},
    });

    expect(calls).toEqual([
      "reply:慢路先完成",
      "delete:1:11",
    ]);
  });
});
