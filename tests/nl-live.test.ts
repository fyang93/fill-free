import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/scheduling/app/types";
import { clearRecentClarification, getRecentClarification, loadPersistentState, rememberRecentClarification, state } from "../src/scheduling/app/state";
import { AiService } from "../src/support/ai";
import { buildResponderContextBlock, lookupRequesterTimezone, lookupResponderIndexContext } from "../src/operations/context/responder";
import { executeAiActions } from "../src/roles/executor";
import { dequeueRunnableTask, markTaskState, removeTask } from "../src/support/tasks/runtime/store";
import { runTaskWithHandlers } from "../src/support/tasks/runtime/handlers";
import { buildReminderEvent, createReminderEvent, readReminderEvents } from "../src/operations/reminders/store";
import { normalizeScheduledAt } from "../src/operations/reminders";
import { rebuildInvertedIndexFromMemoryKeywords } from "../src/operations/context/inverted-index";
import { rememberTelegramUser } from "../src/interaction/telegram/registry";
import { listRules } from "../src/operations/context/rules-store";
import { collectRelevantRules } from "../src/operations/context/store";
import { createMaintainerRunner } from "../src/operations/maintenance/deep";
import { matchInvertedIndex } from "../src/operations/context/inverted-index";

const tempDirs: string[] = [];
const hostRepoRoot = process.cwd();
const LIVE_TEST_TIMEOUT_MS = 120_000;

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
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "defect-bot-nl-live-"));
  tempDirs.push(repoRoot);
  await mkdir(path.join(repoRoot, "system"), { recursive: true });
  await mkdir(path.join(repoRoot, "logs", "test-runs"), { recursive: true });
  await mkdir(path.join(hostRepoRoot, "logs", "test-runs"), { recursive: true });
  await mkdir(path.join(repoRoot, "memory", "people"), { recursive: true });
  await writeFile(path.join(repoRoot, "system", "users.json"), '{"users":{}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "chats.json"), '{"chats":{}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "rules.json"), '{"rules":[]}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "tasks.json"), '{"tasks":[]}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "state.json"), '{}\n', "utf8");
  const config = createTestConfig(repoRoot);
  process.chdir(repoRoot);
  await loadPersistentState(config.paths.stateFile);
  rememberTelegramUser({ id: 1, username: "admin_test", first_name: "Admin", last_name: "Test" });
  return config;
}

async function appendLiveLog(config: AppConfig, entry: Record<string, unknown>): Promise<void> {
  const filePath = path.join(hostRepoRoot, "logs", "test-runs", "nl-live.log");
  await appendFile(filePath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`, "utf8");
}

async function readUsersDocument(repoRoot: string): Promise<Record<string, Record<string, unknown>>> {
  const filePath = path.join(repoRoot, "system", "users.json");
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as { users?: Record<string, unknown> };
  return Object.fromEntries(
    Object.entries(parsed.users && typeof parsed.users === "object" ? parsed.users : {})
      .map(([key, value]) => [key, value && typeof value === "object" ? value as Record<string, unknown> : {}]),
  );
}

async function buildResponderContext(config: AppConfig, requesterUserId: number, chatId: number, promptText: string): Promise<{ responderContextText: string; requesterTimezone: string | null }> {
  const indexContext = await lookupResponderIndexContext(config, promptText);
  const responderContextText = await buildResponderContextBlock(config, { requesterUserId, chatId, indexContext });
  return {
    responderContextText,
    requesterTimezone: lookupRequesterTimezone(config, requesterUserId),
  };
}

async function drainQueuedTasks(config: AppConfig, agentService: AiService): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  while (true) {
    const task = await dequeueRunnableTask(config);
    if (!task) break;
    const output = await runTaskWithHandlers({ config, agentService, bot: {} as any }, task);
    results.push({ taskId: task.id, domain: task.domain, operation: task.operation, result: output.result || {} });
    await markTaskState(config, task.id, "done", { result: output.result || {} });
    await removeTask(config, task.id);
  }
  return results;
}

function explicitClockTimeDetail(text: string): string | null {
  const trimmed = text.trim();
  const colon = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  const compact = trimmed.match(/^(\d{1,2})(\d{2})$/);
  const hour = Number(colon?.[1] || compact?.[1]);
  const minute = Number(colon?.[2] || compact?.[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function localDateAtIso(iso: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

async function runLiveScenario(config: AppConfig, agentService: AiService, input: string): Promise<{ answer: any; actionResult: any; taskResults: Array<Record<string, unknown>> }> {
  const requesterUserId = 1;
  const chatId = 1;
  const recentClarification = getRecentClarification(`user:${requesterUserId}`);
  const normalizedClockTime = recentClarification ? explicitClockTimeDetail(input) : null;
  const requesterTimezoneHint = "Asia/Tokyo";
  const deterministicTimeContext = normalizedClockTime
    ? [
        `Deterministic parsed time detail: the current user message is an explicit local clock time meaning ${normalizedClockTime} in the requester timezone ${requesterTimezoneHint}.`,
        `Deterministic resolved local date for this turn: ${localDateAtIso(new Date().toISOString(), requesterTimezoneHint)}.`,
        `Deterministic UTC timestamp for that local date and time: ${normalizeScheduledAt(`${localDateAtIso(new Date().toISOString(), requesterTimezoneHint)}T${normalizedClockTime}:00`, requesterTimezoneHint)}.`,
      ].join("\n")
    : null;
  const effectiveInput = recentClarification
    ? [
        "Current user message:",
        input,
        "",
        "Recent clarification context:",
        `Previous user request: ${recentClarification.requestText}`,
        `Previous assistant clarification: ${recentClarification.clarificationMessage}`,
        "Treat the current user message as a likely answer to that clarification when it fits.",
        deterministicTimeContext || "",
      ].filter(Boolean).join("\n")
    : input;
  const { responderContextText, requesterTimezone } = await buildResponderContext(config, requesterUserId, chatId, effectiveInput);
  const answer = await agentService.prompt(effectiveInput, [], [], undefined, undefined, undefined, "admin", responderContextText, requesterTimezone);
  if (answer.answerMode === "needs-clarification") {
    rememberRecentClarification(`user:${requesterUserId}`, input, answer.message);
  } else {
    clearRecentClarification(`user:${requesterUserId}`);
  }
  await appendLiveLog(config, { stage: "responder", input, effectiveInput, answer });

  const actionResult = answer.answerMode === "needs-execution"
    ? await executeAiActions({
      config,
      agentService,
      answer,
      ctx: { chat: { id: chatId, type: "private" }, message: { message_id: 1, text: input } } as any,
      requesterUserId,
      canDeliverOutbound: true,
      accessRole: "admin",
      userRequestText: input,
      responderContextText,
      isTaskCurrent: () => true,
    })
    : { message: "", facts: [], hasSideEffectfulActions: false };
  await appendLiveLog(config, { stage: "executor", input, actionResult });

  const taskResults = await drainQueuedTasks(config, agentService);
  await appendLiveLog(config, { stage: "tasks", input, taskResults });
  return { answer, actionResult, taskResults };
}

async function runLiveScenarioWithRetries(config: AppConfig, agentService: AiService, input: string, attempts = 3): Promise<{ answer: any; actionResult: any; taskResults: Array<Record<string, unknown>> }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await runLiveScenario(config, agentService, input);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      await appendLiveLog(config, { stage: "retry", input, attempt, error: message });
      if (!message.includes("Executor output protocol violation") && !message.includes("Model returned no displayable output.")) {
        throw error;
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

afterEach(async () => {
  state.telegramUserCache = {};
  state.telegramChatCache = {};
  state.userTimezoneCache = {};
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("自然语言 live 回归测试", () => {
  test("管理员自然语言创建提醒后能真实落地", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    const result = await runLiveScenario(config, agentService, "添加提醒：2026年4月7日下午3点测试会议");
    expect(result.answer.answerMode).toBe("needs-execution");
    const reminders = await readReminderEvents(config);
    expect(reminders.some((item) => item.title.includes("测试会议") && item.status === "active")).toBe(true);
  });

  test("管理员自然语言在提醒缺少必要时间细节时会先澄清而不会提前执行", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    const result = await runLiveScenarioWithRetries(config, agentService, "下午提醒我review论文");
    expect(result.answer.answerMode).toBe("needs-clarification");
    expect(result.answer.message.includes("几点") || result.answer.message.includes("时间") || result.answer.message.includes("具体")).toBe(true);
    expect(result.taskResults.length).toBe(0);

    const reminders = await readReminderEvents(config);
    expect(reminders.length).toBe(0);
  });

  test("管理员在澄清后补充具体时间时会沿用刚才的提醒语境", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    const first = await runLiveScenarioWithRetries(config, agentService, "下午提醒我review论文");
    expect(first.answer.answerMode).toBe("needs-clarification");

    const second = await runLiveScenarioWithRetries(config, agentService, "1700");
    expect(second.answer.answerMode).toBe("needs-execution");

    const reminders = await readReminderEvents(config);
    const reminder = reminders.find((item) => item.title.includes("review") || item.title.includes("论文"));
    expect(Boolean(reminder)).toBe(true);
    expect(reminder?.schedule.kind).toBe("once");
    if (reminder?.schedule.kind === "once") {
      expect(reminder.schedule.scheduledAt.includes("T17:00:00") || reminder.schedule.scheduledAt.includes("T08:00:00.000Z")).toBe(true);
    }
  });

  test("管理员在澄清后补充 2100 时不会被错误换算成别的本地时间", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    const first = await runLiveScenarioWithRetries(config, agentService, "等下提醒我review论文");
    expect(first.answer.answerMode).toBe("needs-clarification");

    const second = await runLiveScenarioWithRetries(config, agentService, "2100");
    expect(second.answer.answerMode).toBe("needs-execution");
    expect(second.answer.message.includes("21:00") || second.answer.message.includes("21点") || second.answer.message.includes("晚上9点")).toBe(true);
    expect(second.answer.message.includes("17:00") || second.answer.message.includes("17点")).toBe(false);

    const taskResults = second.taskResults.filter((item) => item.domain === "reminders");
    expect(taskResults.some((item) => (item.operation === "create" || item.operation === "upsert") && (item.result as Record<string, unknown>)?.changed === true)).toBe(true);

    const reminders = await readReminderEvents(config);
    const reminder = reminders.find((item) => item.title.includes("review") || item.title.includes("论文"));
    expect(Boolean(reminder)).toBe(true);
    expect(reminder?.schedule.kind).toBe("once");
    if (reminder?.schedule.kind === "once") {
      expect(reminder.schedule.scheduledAt.includes("T21:00:00") || reminder.schedule.scheduledAt.includes("T12:00:00.000Z")).toBe(true);
    }
    expect(reminder?.timezone).toBe("Asia/Tokyo");
  });

  test("管理员自然语言删除提醒后能真实落地", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    await createReminderEvent(buildReminderEvent(config, {
      title: "测试会议",
      timeSemantics: "absolute",
      timezone: "Asia/Tokyo",
      schedule: { kind: "once", scheduledAt: "2026-04-07T06:00:00.000Z" },
      notifications: [{ id: "n1", offsetMinutes: -60, enabled: true }],
      targets: [{ targetKind: "user", targetId: 1 }],
    }, "Asia/Tokyo"), config);

    const result = await runLiveScenario(config, agentService, "删除 4/7 那个测试会议提醒");
    expect(result.answer.answerMode).toBe("needs-execution");
    const reminders = await readReminderEvents(config);
    expect(reminders.find((item) => item.title === "测试会议")?.status).toBe("deleted");
  });

  test("管理员自然语言查询资料时能命中 memory keywords 注入上下文", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    await writeFile(path.join(config.paths.repoRoot, "memory", "people", "test-rain.md"), "---\nkeywords:\n  - 测试雨\n  - test_rain\n---\n- name: 测试雨\n- hobby: baking\n", "utf8");
    await rebuildInvertedIndexFromMemoryKeywords(config.paths.repoRoot);

    const result = await runLiveScenario(config, agentService, "查一下测试雨的资料");
    expect(result.answer.message).toContain("测试雨");
  });

  test("管理员查询当前提醒列表时 responder 直接回答且不编造检索过程", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    await writeFile(path.join(config.paths.repoRoot, "system", "users.json"), `${JSON.stringify({
      users: {
        "1": {
          username: "admin_test",
          displayName: "Admin Test",
          timezone: "Asia/Tokyo",
        },
      },
    }, null, 2)}\n`, "utf8");

    await createReminderEvent(buildReminderEvent(config, {
      title: "测试会议",
      timeSemantics: "absolute",
      timezone: "Asia/Tokyo",
      schedule: { kind: "once", scheduledAt: "2026-04-07T06:00:00.000Z" },
      notifications: [{ id: "n1", offsetMinutes: -60, enabled: true }],
      targets: [{ targetKind: "user", targetId: 1 }],
    }, "Asia/Tokyo"), config);

    const result = await runLiveScenarioWithRetries(config, agentService, "现在有些什么提醒");
    expect(result.answer.answerMode).toBe("direct");
    expect(result.answer.message).toContain("测试会议");
    expect(result.answer.message.includes("[输出开始]") || result.answer.message.includes("[输出结束]")).toBe(false);
    expect(result.answer.message.includes("计算中") || result.answer.message.includes("检索到") || result.answer.message.includes("系统待命")).toBe(false);
    expect(result.taskResults.length).toBe(0);
  });

  test("管理员查询已有提醒时间时 responder 会按用户时区表达而不是裸 UTC", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    await writeFile(path.join(config.paths.repoRoot, "system", "users.json"), `${JSON.stringify({
      users: {
        "1": {
          username: "admin_test",
          displayName: "Admin Test",
          timezone: "Asia/Tokyo",
        },
      },
    }, null, 2)}\n`, "utf8");

    await createReminderEvent(buildReminderEvent(config, {
      title: "测试会议",
      timeSemantics: "absolute",
      timezone: "Asia/Tokyo",
      schedule: { kind: "once", scheduledAt: "2026-04-07T06:00:00.000Z" },
      notifications: [{ id: "n1", offsetMinutes: -60, enabled: true }],
      targets: [{ targetKind: "user", targetId: 1 }],
    }, "Asia/Tokyo"), config);

    const result = await runLiveScenario(config, agentService, "4月7日那个测试会议提醒是什么时候？");
    expect(result.answer.answerMode).toBe("direct");
    expect(result.answer.message.includes("15:00") || result.answer.message.includes("下午3") || result.answer.message.includes("15点")).toBe(true);
    expect(result.answer.message.includes("UTC")).toBe(false);
  });

  test("管理员自然语言创建每周五下班买菜提醒时若缺少精确下班时间会先澄清", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    await writeFile(path.join(config.paths.repoRoot, "system", "users.json"), `${JSON.stringify({
      users: {
        "1": {
          username: "admin_test",
          displayName: "Admin Test",
          timezone: "Asia/Tokyo",
        },
      },
    }, null, 2)}\n`, "utf8");

    const result = await runLiveScenarioWithRetries(config, agentService, "每个星期五提醒我下班去买菜");
    expect(result.answer.answerMode).toBe("needs-clarification");
    expect(result.answer.message.includes("UTC")).toBe(false);
    expect(result.answer.message.includes("几点") || result.answer.message.includes("时间") || result.answer.message.includes("18:00")).toBe(true);

    const reminders = await readReminderEvents(config);
    const reminder = reminders.find((item) => item.status === "active" && item.title.includes("买菜"));
    expect(Boolean(reminder)).toBe(false);
  });

  test("管理员自然语言暂停某个周期提醒后能真实落地", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    await createReminderEvent(buildReminderEvent(config, {
      title: "下班去买菜",
      timeSemantics: "local",
      timezone: "Asia/Tokyo",
      schedule: { kind: "weekly", every: 1, daysOfWeek: [5], time: { hour: 18, minute: 0 } },
      notifications: [{ id: "n1", offsetMinutes: 0, enabled: true }],
      targets: [{ targetKind: "user", targetId: 1 }],
    }, "Asia/Tokyo"), config);
    await createReminderEvent(buildReminderEvent(config, {
      title: "晨跑",
      timeSemantics: "local",
      timezone: "Asia/Tokyo",
      schedule: { kind: "weekly", every: 1, daysOfWeek: [2], time: { hour: 7, minute: 0 } },
      notifications: [{ id: "n1", offsetMinutes: 0, enabled: true }],
      targets: [{ targetKind: "user", targetId: 1 }],
    }, "Asia/Tokyo"), config);

    const result = await runLiveScenarioWithRetries(config, agentService, "暂停每周五买菜那个提醒");
    expect(result.answer.answerMode).toBe("needs-execution");
    expect(result.taskResults.some((item) => item.domain === "reminders" && item.operation === "pause" && (item.result as Record<string, unknown>)?.changed === true)).toBe(true);

    const reminders = await readReminderEvents(config);
    expect(reminders.find((item) => item.title.includes("买菜"))?.status).toBe("paused");
    expect(reminders.find((item) => item.title.includes("晨跑"))?.status).toBe("active");
  });

  test("管理员自然语言恢复某些周期提醒后能真实落地", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    await createReminderEvent(buildReminderEvent(config, {
      title: "下班去买菜",
      timeSemantics: "local",
      timezone: "Asia/Tokyo",
      schedule: { kind: "weekly", every: 1, daysOfWeek: [5], time: { hour: 18, minute: 0 } },
      notifications: [{ id: "n1", offsetMinutes: 0, enabled: true }],
      targets: [{ targetKind: "user", targetId: 1 }],
      status: "paused",
    }, "Asia/Tokyo"), config);
    await createReminderEvent(buildReminderEvent(config, {
      title: "晨跑",
      timeSemantics: "local",
      timezone: "Asia/Tokyo",
      schedule: { kind: "weekly", every: 1, daysOfWeek: [2], time: { hour: 7, minute: 0 } },
      notifications: [{ id: "n1", offsetMinutes: 0, enabled: true }],
      targets: [{ targetKind: "user", targetId: 1 }],
      status: "paused",
    }, "Asia/Tokyo"), config);
    await createReminderEvent(buildReminderEvent(config, {
      title: "背单词",
      timeSemantics: "local",
      timezone: "Asia/Tokyo",
      schedule: { kind: "weekly", every: 1, daysOfWeek: [1], time: { hour: 21, minute: 0 } },
      notifications: [{ id: "n1", offsetMinutes: 0, enabled: true }],
      targets: [{ targetKind: "user", targetId: 1 }],
      status: "paused",
    }, "Asia/Tokyo"), config);

    const result = await runLiveScenarioWithRetries(config, agentService, "恢复买菜和晨跑这两个周期提醒");
    expect(result.answer.answerMode).toBe("needs-execution");
    const resumeResults = result.taskResults.filter((item) => item.domain === "reminders" && item.operation === "resume" && (item.result as Record<string, unknown>)?.changed === true);
    expect(resumeResults.length).toBeGreaterThanOrEqual(2);

    const reminders = await readReminderEvents(config);
    expect(reminders.find((item) => item.title.includes("买菜"))?.status).toBe("active");
    expect(reminders.find((item) => item.title.includes("晨跑"))?.status).toBe("active");
    expect(reminders.find((item) => item.title.includes("背单词"))?.status).toBe("paused");
  });

  test("管理员自然语言添加农历提醒时能落成 lunar reminder", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    await writeFile(path.join(config.paths.repoRoot, "system", "users.json"), `${JSON.stringify({
      users: {
        "1": {
          username: "admin_test",
          displayName: "Admin Test",
          timezone: "Asia/Tokyo",
        },
      },
    }, null, 2)}\n`, "utf8");

    const input = "每年农历八月十五晚上八点提醒我赏月";
    const result = await runLiveScenarioWithRetries(config, agentService, input);
    expect(result.answer.answerMode).toBe("needs-execution");
    expect(result.answer.message.includes("UTC")).toBe(false);
    expect(result.answer.message.includes("农历") || result.answer.message.includes("八月十五")).toBe(true);

    const reminders = await readReminderEvents(config);
    const reminder = reminders.find((item) => item.status === "active" && item.title.includes("赏月"));
    expect(Boolean(reminder)).toBe(true);
    expect(reminder?.timezone).toBe("Asia/Tokyo");
    expect(reminder?.schedule.kind).toBe("lunarYearly");
    if (reminder?.schedule.kind === "lunarYearly") {
      expect(reminder.schedule.month).toBe(8);
      expect(reminder.schedule.day).toBe(15);
      expect(reminder.schedule.time.hour).toBe(20);
      expect(reminder.schedule.time.minute).toBe(0);
    }
  });

  test("管理员自然语言设置明天解释规则后能写入 rules", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    const input = "以后如果我在凌晨提到明天，要先考虑我有时其实是在说已经开始的这一天。";
    const result = await runLiveScenarioWithRetries(config, agentService, input);
    expect(result.answer.answerMode).toBe("needs-execution");
    expect(result.taskResults.some((item) => item.domain === "rules" && item.operation === "upsert" && (item.result as Record<string, unknown>)?.changed === true)).toBe(true);

    const rules = listRules(config.paths.repoRoot);
    expect(rules.length).toBeGreaterThan(0);
    const relevant = collectRelevantRules(config.paths.repoRoot, { requesterUserId: 1 });
    expect(relevant.length).toBeGreaterThan(0);
    expect(JSON.stringify(relevant)).toContain("明天");
  });

  test("管理员自然语言设置快递地址补充规则后能写入 rules", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    const input = "之后我问你要快递地址的时候，把人名和手机号也一起输出给我。";
    const result = await runLiveScenarioWithRetries(config, agentService, input);
    expect(result.answer.answerMode).toBe("needs-execution");
    expect(result.taskResults.some((item) => item.domain === "rules" && item.operation === "upsert" && (item.result as Record<string, unknown>)?.changed === true)).toBe(true);

    const rules = listRules(config.paths.repoRoot);
    expect(rules.length).toBeGreaterThan(0);
    const relevant = collectRelevantRules(config.paths.repoRoot, { requesterUserId: 1 });
    expect(relevant.length).toBeGreaterThan(0);
    const relevantText = JSON.stringify(relevant);
    expect(relevantText.includes("快递地址") || relevantText.includes("地址")).toBe(true);
    expect(relevantText).toContain("手机号");
    expect(relevantText.includes("人名") || relevantText.includes("姓名")).toBe(true);
  });

  test("管理员自然语言批量设置用户权限后能真实落地", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    rememberTelegramUser({ id: 8631425224, username: "test_rain", first_name: "测试", last_name: "雨" });
    rememberTelegramUser({ id: 5754713371, username: "test_star", first_name: "测试", last_name: "星" });

    const result = await runLiveScenario(config, agentService, "把 test_rain 和 test_star 都设为 trusted");
    expect(result.answer.answerMode).toBe("needs-execution");

    const users = await readUsersDocument(config.paths.repoRoot);
    expect(users["8631425224"]?.role).toBe("trusted");
    expect(users["5754713371"]?.role).toBe("trusted");
  });

  test("管理员自然语言删除所有组会提醒后能真实落地", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    await createReminderEvent(buildReminderEvent(config, {
      title: "组会",
      timeSemantics: "absolute",
      timezone: "Asia/Tokyo",
      schedule: { kind: "once", scheduledAt: "2026-04-08T06:00:00.000Z" },
      notifications: [{ id: "n1", offsetMinutes: -60, enabled: true }],
      targets: [{ targetKind: "user", targetId: 1 }],
    }, "Asia/Tokyo"), config);
    await createReminderEvent(buildReminderEvent(config, {
      title: "组会提醒",
      timeSemantics: "absolute",
      timezone: "Asia/Tokyo",
      schedule: { kind: "once", scheduledAt: "2026-04-07T06:00:00.000Z" },
      notifications: [{ id: "n1", offsetMinutes: -1440, enabled: true }],
      targets: [{ targetKind: "user", targetId: 1 }],
    }, "Asia/Tokyo"), config);

    const result = await runLiveScenarioWithRetries(config, agentService, "删除所有组会提醒");
    expect(result.answer.answerMode).toBe("needs-execution");

    const reminders = await readReminderEvents(config);
    const activeGroupReminders = reminders.filter((item) => item.status === "active" && item.title.includes("组会"));
    expect(activeGroupReminders.length).toBe(0);
  });

  test("maintainer 能为 memory 文件补 keywords 并写入 inverted index", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    const relativePath = path.join("memory", "people", "test-keyword-source.md");
    await writeFile(path.join(config.paths.repoRoot, relativePath), "- name: 测试流云\n- alias: test_cloud\n- topic: 晨间日程\n", "utf8");

    const runner = createMaintainerRunner(config, agentService, { isBusy: () => false });
    await runner.runNow();
    if (runner.timer) clearInterval(runner.timer);

    const updatedText = await readFile(path.join(config.paths.repoRoot, relativePath), "utf8");
    expect(updatedText).toContain("keywords:");
    const matched = await matchInvertedIndex(config.paths.repoRoot, "查一下测试流云的资料");
    expect(matched.paths).toContain("memory/people/test-keyword-source.md");
  });

  test("maintainer 回填 keywords 时不会把已有事实写错，例如羊帆不会被改成杨帆", { timeout: LIVE_TEST_TIMEOUT_MS }, async () => {
    const config = await createTempConfig();
    const agentService = new AiService(config);
    await agentService.ensureReady();

    const relativePath = path.join("memory", "people", "test-yangfan-facts.md");
    await writeFile(path.join(config.paths.repoRoot, relativePath), "- name: 羊帆\n- alias: yangfan\n- note: 姓羊，不是杨。\n", "utf8");

    const runner = createMaintainerRunner(config, agentService, { isBusy: () => false });
    await runner.runNow();
    if (runner.timer) clearInterval(runner.timer);

    const updatedText = await readFile(path.join(config.paths.repoRoot, relativePath), "utf8");
    expect(updatedText).toContain("keywords:");
    expect(updatedText).toContain("羊帆");
    expect(updatedText).toContain("姓羊，不是杨");
    expect(updatedText.includes("- name: 杨帆") || updatedText.includes("name: 杨帆")).toBe(false);
  });
});
