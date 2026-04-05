import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "../src/scheduling/app/types";
import { AiService } from "../src/support/ai";

function createTestConfig(): AppConfig {
  const repoRoot = path.join(os.tmpdir(), "defect-bot-gateway-tools-test");
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

describe("gateway responder tool restrictions", () => {
  test("responder and greeter explicitly disable mcp along with other tools", () => {
    const service = new AiService(createTestConfig()) as any;
    const responderTools = service.toolsForRole("responder");
    const greeterTools = service.toolsForRole("greeter");

    expect(responderTools?.websearch).toBe(false);
    expect(responderTools?.webfetch).toBe(false);
    expect(responderTools?.codesearch).toBe(false);
    expect(responderTools?.mcp).toBe(false);

    expect(greeterTools?.mcp).toBe(false);
  });
});
