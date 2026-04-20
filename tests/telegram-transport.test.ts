import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/bot/app/types";
import { saveTelegramFileFromMessage } from "../src/bot/telegram/transport";

function createTestConfig(repoRoot: string): AppConfig {
  return {
    telegram: {
      botToken: "test-token",
      adminUserId: 1,
      waitingMessage: "",
      inputMergeWindowSeconds: 3,
      menuPageSize: 8,
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
  };
}

describe("telegram file persistence", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("preserves CJK document filenames with only conservative sanitization", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "defect-bot-transport-"));
    try {
      await mkdir(path.join(repoRoot, "tmp"), { recursive: true });
      const config = createTestConfig(repoRoot);
      globalThis.fetch = (async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 })) as typeof fetch;

      const uploaded = await saveTelegramFileFromMessage({
        api: {
          getFile: async () => ({ file_path: "docs/file.xlsx" }),
        },
      } as any, config, {
        document: {
          file_id: "f1",
          file_unique_id: "u1",
          file_name: "研究業務日誌（2026.4）.xlsx",
          mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      });

      expect(uploaded).not.toBeNull();
      expect(uploaded?.originalName).toBe("研究業務日誌（2026.4）.xlsx");
      expect(uploaded?.filename).toBe("研究業務日誌（2026.4）.xlsx");
      expect(uploaded?.savedPath).toContain("研究業務日誌（2026.4）.xlsx");
      await access(uploaded!.absolutePath);

      const filesStoreRaw = await readFile(path.join(repoRoot, "system", "files.json"), "utf8");
      expect(filesStoreRaw).toContain("研究業務日誌（2026.4）.xlsx");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test("strips path separators but keeps Unicode meaning", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "defect-bot-transport-"));
    try {
      await mkdir(path.join(repoRoot, "tmp"), { recursive: true });
      const config = createTestConfig(repoRoot);
      globalThis.fetch = (async () => new Response(new Uint8Array([4, 5, 6]), { status: 200 })) as typeof fetch;

      const uploaded = await saveTelegramFileFromMessage({
        api: {
          getFile: async () => ({ file_path: "docs/file.xlsx" }),
        },
      } as any, config, {
        document: {
          file_id: "f2",
          file_unique_id: "u2",
          file_name: "foo\\研究業務日誌/2026年4月.xlsx",
          mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      });

      expect(uploaded).not.toBeNull();
      expect(uploaded?.originalName).toBe("2026年4月.xlsx");
      expect(uploaded?.filename).toBe("2026年4月.xlsx");
      expect(uploaded?.savedPath).toContain("2026年4月.xlsx");
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });
});
