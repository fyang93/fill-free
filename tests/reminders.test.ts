import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/scheduling/app/types";
import { buildReminderEvent, createReminderEvent, readReminderEvents } from "../src/operations/reminders/store";
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
      kind: "task",
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
      kind: "task",
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
      kind: "task",
      timeSemantics: "absolute",
      timezone: "Asia/Tokyo",
      schedule: { kind: "once", scheduledAt: "2026-04-07T06:00:00.000Z" },
      notifications: [{ id: "n1", offsetMinutes: -1440, enabled: true }],
      targets: [{ targetKind: "user", targetId: 872940661 }],
    }, "Asia/Tokyo");
    const april8 = buildReminderEvent(config, {
      title: "组会",
      kind: "meeting",
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
});
