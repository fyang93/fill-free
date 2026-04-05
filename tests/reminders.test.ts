import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/scheduling/app/types";
import { buildReminderEvent, createReminderEvent, pruneInactiveReminderEvents, readReminderEvents } from "../src/operations/reminders/store";
import { getCurrentOccurrence, normalizeRecurrence, reminderEventScheduleSummary } from "../src/operations/reminders";
import { runReminderTask } from "../src/operations/reminders/task-actions";
import type { TaskRecord } from "../src/support/tasks/runtime/store";

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
  const repoRoot = await mkdtemp(path.join(os.tmpdir(), "defect-bot-test-"));
  tempDirs.push(repoRoot);
  await mkdir(path.join(repoRoot, "system"), { recursive: true });
  await mkdir(path.join(repoRoot, "logs"), { recursive: true });
  return createTestConfig(repoRoot);
}

function makeTask(payload: Record<string, unknown>, requesterUserId = 872940661): TaskRecord {
  const now = new Date().toISOString();
  return {
    id: "tsk_test",
    state: "queued",
    domain: "reminders",
    operation: "delete",
    payload,
    source: { requesterUserId },
    createdAt: now,
    updatedAt: now,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("reminder task matching", () => {
  test("测试语句：删除 4/7 那个提醒 -> can delete by title + scheduledDate", async () => {
    const config = await createTempConfig();
    const event = buildReminderEvent(config, {
      title: "组会提醒",
      timeSemantics: "absolute",
      timezone: "Asia/Tokyo",
      schedule: { kind: "once", scheduledAt: "2026-04-07T06:00:00.000Z" },
      notifications: [{ id: "n1", offsetMinutes: -1440, enabled: true }],
      targets: [{ targetKind: "user", targetId: 872940661 }],
    }, "Asia/Tokyo");
    await createReminderEvent(event, config);

    const result = await runReminderTask(config, makeTask({
      match: {
        title: "组会提醒",
        scheduledDate: "2026-04-07",
      },
    }));

    expect(result.changed).toBe(true);
    const events = await readReminderEvents(config);
    expect(events.find((item) => item.id === event.id)?.status).toBe("deleted");
  });

  test("测试语句：删除 4/7 15:00 的组会提醒 -> local scheduledAt matches stored UTC reminder", async () => {
    const config = await createTempConfig();
    const event = buildReminderEvent(config, {
      title: "组会提醒",
      timeSemantics: "absolute",
      timezone: "Asia/Tokyo",
      schedule: { kind: "once", scheduledAt: "2026-04-07T06:00:00.000Z" },
      notifications: [{ id: "n1", offsetMinutes: -1440, enabled: true }],
      targets: [{ targetKind: "user", targetId: 872940661 }],
    }, "Asia/Tokyo");
    await createReminderEvent(event, config);

    const result = await runReminderTask(config, makeTask({
      match: {
        title: "组会提醒",
        scheduledAt: "2026-04-07T15:00:00",
      },
    }));

    expect(result.changed).toBe(true);
    const events = await readReminderEvents(config);
    expect(events.find((item) => item.id === event.id)?.status).toBe("deleted");
  });

  test("测试语句：删除 4/7 那个提醒，不应误删别的提醒", async () => {
    const config = await createTempConfig();
    const april7 = buildReminderEvent(config, {
      title: "组会提醒",
      timeSemantics: "absolute",
      timezone: "Asia/Tokyo",
      schedule: { kind: "once", scheduledAt: "2026-04-07T06:00:00.000Z" },
      notifications: [{ id: "n1", offsetMinutes: -1440, enabled: true }],
      targets: [{ targetKind: "user", targetId: 872940661 }],
    }, "Asia/Tokyo");
    const april8 = buildReminderEvent(config, {
      title: "组会",
      timeSemantics: "absolute",
      timezone: "Asia/Tokyo",
      schedule: { kind: "once", scheduledAt: "2026-04-08T06:00:00.000Z" },
      notifications: [{ id: "n1", offsetMinutes: -60, enabled: true }],
      targets: [{ targetKind: "user", targetId: 872940661 }],
    }, "Asia/Tokyo");
    await createReminderEvent(april7, config);
    await createReminderEvent(april8, config);

    const result = await runReminderTask(config, makeTask({
      match: {
        title: "组会提醒",
        scheduledDate: "2026-04-07",
      },
    }));

    expect(result.changed).toBe(true);
    const events = await readReminderEvents(config);
    expect(events.find((item) => item.id === april7.id)?.status).toBe("deleted");
    expect(events.find((item) => item.id === april8.id)?.status).toBe("active");
  });

  test("已过时但仍 active 的一次性提醒不会被启动/maintainer 清理提前删掉", { timeout: 15000 }, async () => {
    const config = await createTempConfig();
    const event = buildReminderEvent(config, {
      title: "错过时段后仍需补发的提醒",
      timeSemantics: "absolute",
      timezone: "Asia/Tokyo",
      schedule: { kind: "once", scheduledAt: "2020-01-01T00:00:00.000Z" },
      notifications: [{ id: "n1", offsetMinutes: 0, enabled: true }],
      targets: [{ targetKind: "user", targetId: 872940661 }],
      status: "active",
    }, "Asia/Tokyo");
    await createReminderEvent(event, config);

    const result = await pruneInactiveReminderEvents(config);

    expect(result.removed).toBe(0);
    const events = await readReminderEvents(config);
    expect(events.find((item) => item.id === event.id)?.status).toBe("active");
  });

  test("paused 的周期提醒不会被 maintainer 清理掉", async () => {
    const config = await createTempConfig();
    const event = buildReminderEvent(config, {
      title: "每周买菜",
      timeSemantics: "local",
      timezone: "Asia/Tokyo",
      schedule: { kind: "weekly", every: 1, daysOfWeek: [5], time: { hour: 18, minute: 0 } },
      notifications: [{ id: "n1", offsetMinutes: 0, enabled: true }],
      targets: [{ targetKind: "user", targetId: 872940661 }],
      status: "paused",
    }, "Asia/Tokyo");
    await createReminderEvent(event, config);

    const result = await pruneInactiveReminderEvents(config);

    expect(result.removed).toBe(0);
    const events = await readReminderEvents(config);
    expect(events.find((item) => item.id === event.id)?.status).toBe("paused");
  });

  test("已完成而 paused 的过期一次性提醒可以被清理", async () => {
    const config = await createTempConfig();
    const event = buildReminderEvent(config, {
      title: "已完成提醒",
      timeSemantics: "absolute",
      timezone: "Asia/Tokyo",
      schedule: { kind: "once", scheduledAt: "2020-01-01T00:00:00.000Z" },
      notifications: [{ id: "n1", offsetMinutes: 0, enabled: true }],
      targets: [{ targetKind: "user", targetId: 872940661 }],
      status: "paused",
    }, "Asia/Tokyo");
    await createReminderEvent(event, config);

    const result = await pruneInactiveReminderEvents(config);

    expect(result.removed).toBe(1);
    expect(result.removedIds).toContain(event.id);
    const events = await readReminderEvents(config);
    expect(events.find((item) => item.id === event.id)).toBeUndefined();
  });

  test("显式闰月提醒默认只在闰月触发", async () => {
    const recurrence = normalizeRecurrence({ kind: "lunarYearly", month: 8, day: 15, isLeapMonth: true });
    expect(recurrence.kind).toBe("lunarYearly");
    if (recurrence.kind === "lunarYearly") {
      expect(recurrence.isLeapMonth).toBe(true);
      expect(recurrence.leapMonthPolicy).toBe("same-leap-only");
    }
  });

  test("reminder upsert task without explicit targets can still create a self reminder in requester timezone", async () => {
    const config = await createTempConfig();
    const now = new Date().toISOString();
    const result = await runReminderTask(config, {
      id: "tsk_upsert_create",
      state: "queued",
      domain: "reminders",
      operation: "upsert",
      payload: {
        title: "review论文",
        schedule: { kind: "once", scheduledAt: "2026-04-05T21:00:00" },
      },
      source: { requesterUserId: 872940661 },
      createdAt: now,
      updatedAt: now,
    });

    expect(result.changed).toBe(true);
    const events = await readReminderEvents(config);
    const created = events.find((item) => item.title.includes("review"));
    expect(Boolean(created)).toBe(true);
    expect(created?.timezone).toBe("Asia/Tokyo");
    expect(created?.targets).toEqual([{ targetKind: "user", targetId: 872940661 }]);
    expect(created?.schedule.kind).toBe("once");
    if (created?.schedule.kind === "once") {
      expect(created.schedule.scheduledAt).toBe("2026-04-05T12:00:00.000Z");
    }
  });

  test("特殊提醒的语义由 category + specialKind 表达，不再和顶层 kind 重复", async () => {
    const config = await createTempConfig();
    const event = buildReminderEvent(config, {
      title: "妈妈生日",
      specialKind: "birthday",
      timeSemantics: "local",
      timezone: "Asia/Tokyo",
      schedule: { kind: "yearly", every: 1, month: 6, day: 1, time: { hour: 8, minute: 0 } },
      targets: [{ targetKind: "user", targetId: 872940661 }],
    }, "Asia/Tokyo");
    expect(event.specialKind).toBe("birthday");
    expect(event.category).toBe("special");
  });

  test("农历年度提醒可以正常计算下一次 occurrence 并保留可读摘要", async () => {
    const config = await createTempConfig();
    const event = buildReminderEvent(config, {
      title: "中秋赏月",
      timeSemantics: "local",
      timezone: "Asia/Tokyo",
      schedule: { kind: "lunarYearly", month: 8, day: 15, time: { hour: 20, minute: 0 } },
      notifications: [{ id: "n1", offsetMinutes: -60, enabled: true }],
      targets: [{ targetKind: "user", targetId: 872940661 }],
    }, "Asia/Tokyo");
    await createReminderEvent(event, config);

    const occurrence = getCurrentOccurrence(event, new Date("2026-01-01T00:00:00.000Z"));
    expect(occurrence).not.toBeNull();
    expect(new Date(String(occurrence?.scheduledAt)).getTime()).toBeGreaterThan(new Date("2026-01-01T00:00:00.000Z").getTime());

    const summary = reminderEventScheduleSummary(config, event);
    expect(summary).toContain("农历");
    expect(summary).toContain("八月");
    expect(summary).toContain("十五");
  });
});
