import { afterEach, describe, expect, test } from "bun:test";
import { appendFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/scheduling/app/types";
import { buildReminderEvent, createReminderEvent, readReminderEvents } from "../src/operations/reminders/store";
import { runReminderTask } from "../src/operations/reminders/task-actions";
import type { TaskRecord } from "../src/support/tasks/runtime/store";
import { rememberTelegramUser } from "../src/interaction/telegram/registry";
import { resolveUser, collectRelevantRules } from "../src/operations/context/store";
import { clearStoredUserRole, clearStoredUserRoles, setStoredUserRole, setStoredUserRoles } from "../src/operations/access/roles";
import { rebuildInvertedIndexFromMemoryKeywords, matchInvertedIndex, touchInvertedIndexTerms } from "../src/operations/context/inverted-index";
import { answerRepoQueryTask } from "../src/operations/query/service";
import { listRules, removeRule, upsertRule } from "../src/operations/context/rules-store";
import { loadPersistentState, state } from "../src/scheduling/app/state";

const tempDirs: string[] = [];
const hostRepoRoot = process.cwd();

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
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "defect-bot-nl-test-"));
  tempDirs.push(repoRoot);
  await mkdir(path.join(repoRoot, "system"), { recursive: true });
  await mkdir(path.join(repoRoot, "logs", "test-runs"), { recursive: true });
  await mkdir(path.join(hostRepoRoot, "logs", "test-runs"), { recursive: true });
  await mkdir(path.join(repoRoot, "memory", "people"), { recursive: true });
  await writeFile(path.join(repoRoot, "system", "users.json"), '{"users":{}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "chats.json"), '{"chats":{}}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "rules.json"), '{"rules":[]}\n', "utf8");
  await writeFile(path.join(repoRoot, "system", "state.json"), '{}\n', "utf8");
  const config = createTestConfig(repoRoot);
  process.chdir(repoRoot);
  await loadPersistentState(config.paths.stateFile);
  return config;
}

async function appendScenarioLog(config: AppConfig, entry: Record<string, unknown>): Promise<void> {
  const filePath = path.join(hostRepoRoot, "logs", "test-runs", "nl-regression.log");
  await appendFile(filePath, `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`, "utf8");
}

async function runLoggedScenario<T>(config: AppConfig, input: string, category: string, run: () => Promise<T>): Promise<T> {
  await appendScenarioLog(config, { category, input, state: "start" });
  try {
    const result = await run();
    await appendScenarioLog(config, { category, input, state: "pass", result });
    return result;
  } catch (error) {
    await appendScenarioLog(config, {
      category,
      input,
      state: "fail",
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function makeReminderTask(operation: "update" | "delete", payload: Record<string, unknown>, requesterUserId = 872940661): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: `tsk_${operation}_test`,
    state: "queued",
    domain: "reminders",
    operation,
    payload,
    source: { requesterUserId },
    createdAt: now,
    updatedAt: now,
  };
}

async function readUsersDocument(repoRoot: string): Promise<Record<string, Record<string, unknown>>> {
  const filePath = path.join(repoRoot, "system", "users.json");
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as { users?: Record<string, unknown> };
  return Object.fromEntries(
    Object.entries(parsed.users && typeof parsed.users === "object" ? parsed.users : {})
      .map(([key, value]) => [key, value && typeof value === "object" ? value as Record<string, unknown> : {}]),
  );
}

async function removeUserRecord(repoRoot: string, userId: number): Promise<boolean> {
  const filePath = path.join(repoRoot, "system", "users.json");
  const users = await readUsersDocument(repoRoot);
  const key = String(userId);
  if (!users[key]) return false;
  delete users[key];
  await writeFile(filePath, `${JSON.stringify({ users }, null, 2)}\n`, "utf8");
  delete state.telegramUserCache[key];
  return true;
}

afterEach(async () => {
  state.telegramUserCache = {};
  state.telegramChatCache = {};
  state.userTimezoneCache = {};
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("自然语言回归测试", () => {
  test("提醒的增删查改", async () => {
    const config = await createTempConfig();

    await runLoggedScenario(config, "添加提醒：4月7日下午3点组会提醒", "reminders.create", async () => {
      const event = buildReminderEvent(config, {
        title: "组会提醒",
          timeSemantics: "absolute",
        timezone: "Asia/Tokyo",
        schedule: { kind: "once", scheduledAt: "2026-04-07T06:00:00.000Z" },
        notifications: [{ id: "n1", offsetMinutes: -1440, enabled: true }],
        targets: [{ targetKind: "user", targetId: 872940661 }],
      }, "Asia/Tokyo");
      await createReminderEvent(event, config);
      return { reminderId: event.id };
    });

    const created = await runLoggedScenario(config, "现在有哪些提醒", "reminders.read", async () => {
      const events = await readReminderEvents(config);
      return events.filter((item) => item.status === "active").map((item) => ({ title: item.title, scheduledAt: item.schedule.kind === "once" ? item.schedule.scheduledAt : item.schedule.kind }));
    });
    expect(created.some((item) => item.title === "组会提醒")).toBe(true);

    const updateResult = await runLoggedScenario(config, "把 4/7 的组会提醒改成 4/7 16:00", "reminders.update", async () => runReminderTask(config, makeReminderTask("update", {
      match: { title: "组会提醒", scheduledDate: "2026-04-07" },
      changes: { schedule: { kind: "once", scheduledAt: "2026-04-07T07:00:00.000Z" } },
    })));
    expect(updateResult.changed).toBe(true);

    const updated = await readReminderEvents(config);
    expect(updated.find((item) => item.title === "组会提醒")?.schedule.kind).toBe("once");
    expect((updated.find((item) => item.title === "组会提醒")?.schedule as { kind: "once"; scheduledAt: string } | undefined)?.scheduledAt).toBe("2026-04-07T07:00:00.000Z");

    const deleteResult = await runLoggedScenario(config, "删除 4/7 那个提醒", "reminders.delete", async () => runReminderTask(config, makeReminderTask("delete", {
      match: { title: "组会提醒", scheduledDate: "2026-04-07" },
    })));
    expect(deleteResult.changed).toBe(true);
    expect((await readReminderEvents(config)).find((item) => item.title === "组会提醒")?.status).toBe("deleted");
  });

  test("个人信息的增删查改", async () => {
    const config = await createTempConfig();

    await runLoggedScenario(config, "记住 test_rain 是测试雨", "people.create", async () => {
      rememberTelegramUser({ id: 8631425224, username: "test_rain", first_name: "测试", last_name: "雨" });
      return resolveUser(config.paths.repoRoot, 8631425224);
    });
    expect(resolveUser(config.paths.repoRoot, 8631425224)?.username).toBe("test_rain");

    await runLoggedScenario(config, "把 test_rain 的显示名改成 测试小雨", "people.update", async () => {
      rememberTelegramUser({ id: 8631425224, username: "test_rain", first_name: "测试", last_name: "小雨" });
      return resolveUser(config.paths.repoRoot, 8631425224);
    });
    expect(resolveUser(config.paths.repoRoot, 8631425224)?.displayName).toContain("测试");

    const readResult = await runLoggedScenario(config, "查看 test_rain 的个人信息", "people.read", async () => resolveUser(config.paths.repoRoot, 8631425224));
    expect(readResult?.username).toBe("test_rain");

    const removed = await runLoggedScenario(config, "删除 test_rain 的个人信息", "people.delete", async () => removeUserRecord(config.paths.repoRoot, 8631425224));
    expect(removed).toBe(true);
    expect((await readUsersDocument(config.paths.repoRoot))["8631425224"]).toBeUndefined();
  });

  test("用户权限的设置", async () => {
    const config = await createTempConfig();
    rememberTelegramUser({ id: 8631425224, username: "test_rain", first_name: "测试", last_name: "雨" });

    const granted = await runLoggedScenario(config, "管理员把 test_rain 设为 trusted", "access.set-role", async () => setStoredUserRole(config, 8631425224, "trusted", { username: "test_rain", updatedBy: 1 }));
    expect(granted).toBe(true);
    expect((await readUsersDocument(config.paths.repoRoot))["8631425224"]?.role).toBe("trusted");

    const revoked = await runLoggedScenario(config, "管理员取消 test_rain 的 trusted 权限", "access.clear-role", async () => clearStoredUserRole(config, 8631425224, { username: "test_rain", updatedBy: 1 }));
    expect(revoked).toBe(true);
    expect((await readUsersDocument(config.paths.repoRoot))["8631425224"]?.role).toBeUndefined();
  });

  test("批量设置用户权限", async () => {
    const config = await createTempConfig();
    rememberTelegramUser({ id: 8631425224, username: "test_rain", first_name: "测试", last_name: "雨" });
    rememberTelegramUser({ id: 5754713371, username: "test_star", first_name: "测试", last_name: "星" });

    const batchGranted = await runLoggedScenario(config, "管理员把 test_rain 和 test_star 批量设为 trusted", "access.set-role-batch", async () => setStoredUserRoles(config, [
      { userId: 8631425224, role: "trusted", patch: { username: "test_rain", updatedBy: 1 } },
      { userId: 5754713371, role: "trusted", patch: { username: "test_star", updatedBy: 1 } },
    ]));
    expect(batchGranted.changedUserIds).toEqual([8631425224, 5754713371]);
    const usersAfterGrant = await readUsersDocument(config.paths.repoRoot);
    expect(usersAfterGrant["8631425224"]?.role).toBe("trusted");
    expect(usersAfterGrant["5754713371"]?.role).toBe("trusted");

    const batchCleared = await runLoggedScenario(config, "管理员批量取消 test_rain 和 test_star 的 trusted 权限", "access.clear-role-batch", async () => clearStoredUserRoles(config, [
      { userId: 8631425224, patch: { username: "test_rain", updatedBy: 1 } },
      { userId: 5754713371, patch: { username: "test_star", updatedBy: 1 } },
    ]));
    expect(batchCleared.changedUserIds).toEqual([8631425224, 5754713371]);
    const usersAfterClear = await readUsersDocument(config.paths.repoRoot);
    expect(usersAfterClear["8631425224"]?.role).toBeUndefined();
    expect(usersAfterClear["5754713371"]?.role).toBeUndefined();
  });

  test("倒排索引功能可以正常运行", async () => {
    const config = await createTempConfig();
    const memoryPath = path.join(config.paths.repoRoot, "memory", "people", "test-rain.md");
    await writeFile(memoryPath, "---\nkeywords:\n  - 测试雨\n  - test_rain\n  - 小雨测试\n---\n- name: 测试雨\n- hobby: baking\n- location: Tokyo\n", "utf8");

    await runLoggedScenario(config, "为 memory 文件自动重建倒排索引", "inverted-index.rebuild", async () => rebuildInvertedIndexFromMemoryKeywords(config.paths.repoRoot));

    const matched = await runLoggedScenario(config, "查一下测试雨的资料", "inverted-index.match", async () => matchInvertedIndex(config.paths.repoRoot, "查一下测试雨的资料"));
    expect(matched.matchedTerms).toContain("测试雨");
    expect(matched.paths).toContain("memory/people/test-rain.md");

    await runLoggedScenario(config, "确认测试雨这个索引词被使用过", "inverted-index.touch", async () => {
      await touchInvertedIndexTerms(config.paths.repoRoot, ["测试雨"], { confirm: true });
      return { ok: true };
    });

    const query = await runLoggedScenario(config, "查一下测试雨的资料", "inverted-index.query", async () => answerRepoQueryTask(config, {
      id: "tsk_query_test",
      state: "queued",
      domain: "query",
      operation: "answer-from-repo",
      payload: { requestText: "查一下测试雨的资料" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }));
    expect(query.result.answered).toBe(true);
    expect(String(query.message)).toContain("test-rain.md");
  });

  test("用户设置的规则可以正常写入 rules，规则可以增删查改", async () => {
    const config = await createTempConfig();

    const created = await runLoggedScenario(config, "添加规则：给 test_rain 的提醒默认提前一天", "rules.create", async () => upsertRule(config.paths.repoRoot, {
      topic: "default reminder offsets",
      appliesTo: { domain: "users", selector: "one", userIds: ["8631425224"] },
      content: { reminderOffsets: [-1440] },
      createdBy: "1",
    }));
    expect(created.topic).toBe("default reminder offsets");

    const listed = await runLoggedScenario(config, "查看 test_rain 的规则", "rules.read", async () => listRules(config.paths.repoRoot));
    expect(listed.some((rule) => rule.topic === "default reminder offsets")).toBe(true);

    const updated = await runLoggedScenario(config, "把规则改成提前一天和提前一小时", "rules.update", async () => upsertRule(config.paths.repoRoot, {
      id: created.id,
      topic: "default reminder offsets",
      appliesTo: { domain: "users", selector: "one", userIds: ["8631425224"] },
      content: { reminderOffsets: [-1440, -60] },
      createdBy: "1",
    }));
    expect(updated.content.reminderOffsets).toEqual([-1440, -60]);

    const relevant = await runLoggedScenario(config, "给 test_rain 查相关规则", "rules.collect", async () => collectRelevantRules(config.paths.repoRoot, { requesterUserId: 8631425224 }));
    expect(relevant.some((rule) => rule.id === created.id)).toBe(true);

    const removed = await runLoggedScenario(config, "删除 test_rain 的默认提醒规则", "rules.delete", async () => removeRule(config.paths.repoRoot, { id: created.id }));
    expect(removed).toBe(true);
    expect(listRules(config.paths.repoRoot).some((rule) => rule.id === created.id)).toBe(false);
  });
});
