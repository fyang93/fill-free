import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AppConfig } from "../src/bot/app/types";
import { executeAssistantActions } from "../src/bot/runtime/assistant-actions";
import { handleTelegramSendMessage } from "../src/cli/commands/telegram";
import { CliOutput } from "../src/cli/runtime";
import { dequeueRunnableTask, enqueueTask, markTaskState, removeTask } from "../src/bot/tasks/runtime/store";
import { runTaskWithHandlers } from "../src/bot/tasks/runtime/handlers";
import { rememberTelegramChat, rememberTelegramUser } from "../src/bot/telegram/registry";
import { resolveTelegramTargetUser } from "../src/bot/telegram/targets";

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
      personaStyle: "模仿杀戮尖塔里的故障机器人说话。",
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
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "defect-bot-messages-test-"));
  await mkdir(path.join(repoRoot, "system"), { recursive: true });
  await writeFile(path.join(repoRoot, "system", "users.json"), '{"users":{}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "chats.json"), '{"chats":{}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "tasks.json"), '{"tasks":[]}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "state.json"), '{}\n', "utf8");
  await writeFile(path.join(repoRoot, "config.toml"), [
    "[telegram]",
    'bot_token = "test"',
    "admin_user_id = 1",
    "",
    "[bot]",
    'language = "zh-CN"',
    'persona_style = ""',
    'default_timezone = "Asia/Tokyo"',
    "",
    "[maintenance]",
    "enabled = false",
    'idle_after_minutes = 15',
    "",
    "[opencode]",
    'base_url = "http://127.0.0.1:4096"',
    "",
  ].join("\n"), "utf8");
  const originalCwd = process.cwd();
  process.chdir(repoRoot);
  return { config: createTestConfig(repoRoot), repoRoot, originalCwd };
}

const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

describe("message delivery flow", () => {
  test("assistant queues canonical messages.deliver task with payload.content and handler sends it", async () => {
    const { config, repoRoot, originalCwd } = await createTempConfig();
    try {
      const sent: Array<{ chatId: number; text: string }> = [];
      rememberTelegramChat({ id: -1003674455331, type: "supergroup", title: "锅巴之家" }, [872940661]);
      const agentService = {
        runAssistantTurn: async () => {
          await enqueueTask(config, {
            domain: "messages",
            operation: "deliver",
            subject: { kind: "chat", id: String(-1003674455331) },
            payload: { recipientId: -1003674455331, content: "测试消息" },
          });
          return {
            message: "已发送测试消息到锅巴之家",
            answerMode: "direct",
            usedNativeExecution: true,
            completedActions: ["telegram:send-message"],
          };
        },
        composeDeliveryMessage: async (baseMessage: string) => baseMessage,
      } as any;

      await executeAssistantActions({
        config,
        agentService,
        answer: {
          message: "正在发送测试消息到锅巴之家群...",
          answerMode: "needs-execution",
          files: [],
          fileWrites: [],
          attachments: [],
          schedules: [],
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
          agentService: {
            ...agentService,
            composeDeliveryMessage: async () => { throw new Error("should not compose delivery text"); },
          },
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
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("telegram:send-message requires recipientId", async () => {
    const { repoRoot, originalCwd } = await createTempConfig();
    try {
      const proc = Bun.spawn(["bun", cliPath, "telegram:send-message", JSON.stringify({ content: "hi" })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ ok: false, error: "missing-recipientId-for-message" });
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("telegram:send-message still requires outbound privilege for explicit recipientId", async () => {
    const { repoRoot, originalCwd } = await createTempConfig();
    try {
      const proc = Bun.spawn(["bun", cliPath, "telegram:send-message", JSON.stringify({ requesterUserId: 200, recipientId: 300, content: "hi" })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;
      expect(exitCode).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ ok: false, error: "outbound-delivery-not-allowed" });
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("resolveTelegramTargetUser resolves remembered chat by display name", async () => {
    const { config, originalCwd, repoRoot } = await createTempConfig();
    try {
      rememberTelegramChat({ id: -1003674455331, type: "supergroup", title: "锅巴之家" }, [872940661]);
      const resolved = resolveTelegramTargetUser(
        config,
        { displayName: "锅巴之家" },
        { chat: { id: 872940661, type: "private" }, from: { id: 872940661 }, message: { message_id: 1, text: "发送一条测试消息到锅巴之家" } } as any,
        872940661,
      );
      expect(resolved.status).toBe("resolved");
      expect(resolved.targetKind).toBe("chat");
      expect(resolved.chatId).toBe(-1003674455331);
      expect(resolved.displayName).toBe("锅巴之家");
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("schedules:create accepts schedule passed as JSON string", async () => {
    const { repoRoot, originalCwd } = await createTempConfig();
    try {
      const proc = Bun.spawn(["bun", cliPath, "schedules:create", JSON.stringify({ requesterUserId: 1, title: "喝鸡汤", schedule: JSON.stringify({ kind: "once", scheduledAt: "2026-04-10T06:00:00.000Z" }) })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      expect(await proc.exited).toBe(0);
      expect(stderr).toBe("");
      const jsonStart = stdout.lastIndexOf("\n{") >= 0 ? stdout.lastIndexOf("\n{") + 1 : stdout.indexOf("{");
      const parsed = JSON.parse(stdout.slice(jsonStart));
      expect(parsed.ok).toBe(true);
      expect(parsed.schedule.title).toBe("喝鸡汤");
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("auth:add-pending defaults expiresAt in code", async () => {
    const { repoRoot, originalCwd } = await createTempConfig();
    try {
      const startedAt = Date.now();
      const proc = Bun.spawn(["bun", cliPath, "auth:add-pending", JSON.stringify({ requesterUserId: 1, username: "foo", createdBy: 1 })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      expect(await proc.exited).toBe(0);
      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout);
      expect(parsed.ok).toBe(true);
      expect(typeof parsed.expiresAt).toBe("string");
      const expiresAtMs = Date.parse(parsed.expiresAt);
      expect(Number.isFinite(expiresAtMs)).toBe(true);
      expect(expiresAtMs).toBeGreaterThan(startedAt + (23 * 60 * 60 * 1000));
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("auth:add-pending accepts durations longer than 24 hours", async () => {
    const { repoRoot, originalCwd } = await createTempConfig();
    try {
      const startedAt = Date.now();
      const proc = Bun.spawn(["bun", cliPath, "auth:add-pending", JSON.stringify({ requesterUserId: 1, username: "foo", createdBy: 1, durationMinutes: 7 * 24 * 60 })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      expect(await proc.exited).toBe(0);
      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout);
      expect(parsed.ok).toBe(true);
      const expiresAtMs = Date.parse(parsed.expiresAt);
      expect(expiresAtMs).toBeGreaterThan(startedAt + (6 * 24 * 60 * 60 * 1000));
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("auth:add-pending rejects past or invalid expiresAt", async () => {
    const { repoRoot, originalCwd } = await createTempConfig();
    try {
      const proc = Bun.spawn(["bun", cliPath, "auth:add-pending", JSON.stringify({ requesterUserId: 1, username: "foo", createdBy: 1, expiresAt: "2000-01-01T00:00:00.000Z" })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      expect(await proc.exited).toBe(0);
      expect(stderr).toBe("");
      expect(JSON.parse(stdout)).toEqual({ ok: false, error: "invalid-expiresAt" });
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("telegram:resolve-recipient resolves remembered chat and user by display name", async () => {
    const { repoRoot, originalCwd } = await createTempConfig();
    try {
      rememberTelegramChat({ id: -1003674455331, type: "supergroup", title: "锅巴之家" }, [1]);
      rememberTelegramUser({ id: 1, username: "admin_test", first_name: "Admin", last_name: "Test" }, [1]);

      const chatProc = Bun.spawn(["bun", cliPath, "telegram:resolve-recipient", JSON.stringify({ displayName: "锅巴之家" })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const chatStdout = await new Response(chatProc.stdout).text();
      const chatStderr = await new Response(chatProc.stderr).text();
      expect(await chatProc.exited).toBe(0);
      expect(chatStderr).toBe("");
      expect(JSON.parse(chatStdout)).toEqual({ ok: true, status: "resolved", recipientKind: "chat", recipientId: -1003674455331, recipientLabel: "锅巴之家" });

      const userProc = Bun.spawn(["bun", cliPath, "telegram:resolve-recipient", JSON.stringify({ displayName: "Admin Test" })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const userStdout = await new Response(userProc.stdout).text();
      const userStderr = await new Response(userProc.stderr).text();
      expect(await userProc.exited).toBe(0);
      expect(userStderr).toBe("");
      expect(JSON.parse(userStdout)).toEqual({ ok: true, status: "resolved", recipientKind: "user", recipientId: 1, recipientLabel: "Admin Test (@admin_test)" });
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("telegram:resolve-recipient returns ok false for ambiguous and not_found results", async () => {
    const { repoRoot, originalCwd } = await createTempConfig();
    try {
      rememberTelegramChat({ id: -1001, type: "supergroup", title: "测试群" }, [1]);
      rememberTelegramChat({ id: -1002, type: "supergroup", title: "测试群" }, [1]);

      const ambiguousProc = Bun.spawn(["bun", cliPath, "telegram:resolve-recipient", JSON.stringify({ displayName: "测试群" })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const ambiguousStdout = await new Response(ambiguousProc.stdout).text();
      expect(await ambiguousProc.exited).toBe(0);
      const ambiguous = JSON.parse(ambiguousStdout);
      expect(ambiguous.ok).toBe(false);
      expect(ambiguous.status).toBe("ambiguous");
      expect(ambiguous.error).toBe("ambiguous-recipient");

      const missingProc = Bun.spawn(["bun", cliPath, "telegram:resolve-recipient", JSON.stringify({ displayName: "不存在的对象" })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const missingStdout = await new Response(missingProc.stdout).text();
      expect(await missingProc.exited).toBe(0);
      expect(JSON.parse(missingStdout)).toEqual({ ok: false, status: "not_found", error: "recipient-not-found", targetLabel: "不存在的对象" });
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("waiting message candidates keep rotating after unused pool is exhausted without clearing used flags", async () => {
    const { consumeWaitingMessageCandidate } = await import("../src/bot/runtime/assistant");
    const { state } = await import("../src/bot/app/state");
    const { config, repoRoot, originalCwd } = await createTempConfig();

    try {
      state.waitingMessageCandidates = [
        { text: "A", used: false },
        { text: "B", used: false },
      ];

      const first = await consumeWaitingMessageCandidate(config);
      const second = await consumeWaitingMessageCandidate(config);
      expect(["A", "B"]).toContain(first);
      expect(["A", "B"]).toContain(second);
      expect(state.waitingMessageCandidates.every((item) => item.used)).toBe(true);

      const snapshot = JSON.stringify(state.waitingMessageCandidates);
      const third = await consumeWaitingMessageCandidate(config);

      expect(["A", "B"]).toContain(third);
      expect(third).toBeTruthy();
      expect(JSON.stringify(state.waitingMessageCandidates)).toBe(snapshot);
      expect(state.waitingMessageCandidates.every((item) => item.used)).toBe(true);
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("users:add-rule appends one assistant rule deterministically", async () => {
    const { config, repoRoot, originalCwd } = await createTempConfig();

    try {
      const proc = Bun.spawn(["bun", cliPath, "users:add-rule", JSON.stringify({
        requesterUserId: 1,
        userId: 200,
        rule: "今后回答前先检查本地记忆",
      })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.user.rules).toEqual(["今后回答前先检查本地记忆"]);

      const users = JSON.parse(await readFile(path.join(repoRoot, "system", "users.json"), "utf8"));
      expect(users.users["200"].rules).toEqual(["今后回答前先检查本地记忆"]);
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
      void config;
    }
  });

  test("users:set-rules replaces the full assistant rule list deterministically", async () => {
    const { config, repoRoot, originalCwd } = await createTempConfig();

    try {
      const seed = Bun.spawn(["bun", cliPath, "users:add-rule", JSON.stringify({
        requesterUserId: 1,
        userId: 200,
        rule: "旧规则",
      })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      await seed.exited;

      const proc = Bun.spawn(["bun", cliPath, "users:set-rules", JSON.stringify({
        requesterUserId: 1,
        userId: 200,
        rules: ["今后回答前先检查本地记忆", "遇到生日提醒先查记忆库"],
      })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      await proc.exited;
      const parsed = JSON.parse(stdout.trim());
      expect(parsed.ok).toBe(true);
      expect(parsed.user.rules).toEqual(["今后回答前先检查本地记忆", "遇到生日提醒先查记忆库"]);

      const users = JSON.parse(await readFile(path.join(repoRoot, "system", "users.json"), "utf8"));
      expect(users.users["200"].rules).toEqual(["今后回答前先检查本地记忆", "遇到生日提醒先查记忆库"]);
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
      void config;
    }
  });

  test("users:set-person-path updates a narrow field deterministically", async () => {
    const { repoRoot, originalCwd } = await createTempConfig();
    try {
      await mkdir(path.join(repoRoot, "memory", "people"), { recursive: true });
      await mkdir(path.join(repoRoot, "memory", "people", "yang-fan"), { recursive: true });
      await writeFile(path.join(repoRoot, "memory", "people", "yang-fan", "README.md"), "# 羊帆\n", "utf8");

      const proc = Bun.spawn(["bun", cliPath, "users:set-person-path", JSON.stringify({ requesterUserId: 1, userId: 200, personPath: "memory/people/yang-fan/README.md" })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      expect(await proc.exited).toBe(0);
      const parsed = JSON.parse(stdout);
      expect(parsed.ok).toBe(true);
      expect(parsed.user.personPath).toBe("memory/people/yang-fan/README.md");

      const users = JSON.parse(await readFile(path.join(repoRoot, "system", "users.json"), "utf8"));
      expect(users.users["200"].personPath).toBe("memory/people/yang-fan/README.md");
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("users:set-timezone updates a narrow field deterministically", async () => {
    const { repoRoot, originalCwd } = await createTempConfig();
    try {
      const tzProc = Bun.spawn(["bun", cliPath, "users:set-timezone", JSON.stringify({ requesterUserId: 1, userId: 200, timezone: "Asia/Tokyo" })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const tzStdout = await new Response(tzProc.stdout).text();
      expect(await tzProc.exited).toBe(0);
      const tz = JSON.parse(tzStdout);
      expect(tz.ok).toBe(true);
      expect(tz.user.timezone).toBe("Asia/Tokyo");

      const users = JSON.parse(await readFile(path.join(repoRoot, "system", "users.json"), "utf8"));
      expect(users.users["200"].timezone).toBe("Asia/Tokyo");
      expect(users.users["200"].memoryPath).toBeUndefined();
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("users:list and users:get return ok true on success", async () => {
    const { repoRoot, originalCwd } = await createTempConfig();
    try {
      const listProc = Bun.spawn(["bun", cliPath, "users:list", JSON.stringify({ requesterUserId: 1 })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const listStdout = await new Response(listProc.stdout).text();
      expect(await listProc.exited).toBe(0);
      const listed = JSON.parse(listStdout);
      expect(listed.ok).toBe(true);
      expect(typeof listed.users).toBe("object");

      const getProc = Bun.spawn(["bun", cliPath, "users:get", JSON.stringify({ requesterUserId: 1, userId: 1 })], {
        cwd: repoRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      const getStdout = await new Response(getProc.stdout).text();
      expect(await getProc.exited).toBe(0);
      const got = JSON.parse(getStdout);
      expect(got.ok).toBe(true);
      expect(got.userId).toBe(1);
    } finally {
      process.chdir(originalCwd);
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
