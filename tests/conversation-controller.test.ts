import { describe, expect, test } from "bun:test";
import type { Context } from "grammy";
import type { AppConfig, AiAttachment, UploadedFile } from "../src/scheduling/app/types";
import { ConversationController } from "../src/scheduling/conversations/controller";

function createConfig(): AppConfig {
  return {
    telegram: {
      botToken: "test",
      adminUserId: 1,
      waitingMessage: "",
      waitingMessageCandidates: [],
      waitingMessageRotationSeconds: 0,
      inputMergeWindowSeconds: 3,
      menuPageSize: 8,
    },
    bot: {
      personaStyle: "",
      language: "zh",
      defaultTimezone: "Asia/Tokyo",
    },
    paths: {
      repoRoot: process.cwd(),
      tmpDir: `${process.cwd()}/tmp`,
      uploadSubdir: "telegram",
      logFile: `${process.cwd()}/logs/bot.log`,
      stateFile: `${process.cwd()}/system/runtime-state.json`,
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

function createController() {
  return new ConversationController({
    config: createConfig(),
    bot: {
      api: {
        deleteMessage: async () => {},
      },
    } as any,
    agentService: {
      abortCurrentSession: async () => {},
    } as any,
    isTrustedUserId: () => true,
    isAdminUserId: () => true,
    isAddressedToBot: () => true,
  });
}

function createCtx(messageId: number, userId = 1): Context {
  return {
    chat: { id: 1, type: "private" },
    from: { id: userId },
    message: { message_id: messageId, date: 1 },
  } as any;
}

function createUploadedFile(name: string): UploadedFile {
  return {
    savedPath: `tmp/telegram/${name}`,
    absolutePath: `/tmp/${name}`,
    originalName: name,
    filename: name,
    mimeType: "image/jpeg",
    sizeBytes: 1234,
    source: "photo",
  };
}

function createAttachment(name: string): AiAttachment {
  return {
    mimeType: "image/jpeg",
    filename: name,
    url: `file:///tmp/${name}`,
  };
}

describe("conversation controller input merge window", () => {
  test("merges follow-up text into the active in-flight turn", async () => {
    const controller = createController() as any;
    const starts: Array<{ promptText: string; uploadedFiles: UploadedFile[]; attachments: AiAttachment[]; messageTime?: string }> = [];
    const interrupts: string[] = [];

    controller.startConversationTask = (_ctx: Context, _waitingTemplate: string, promptText: string, uploadedFiles: UploadedFile[], attachments: AiAttachment[], messageTime?: string) => {
      starts.push({ promptText, uploadedFiles, attachments, messageTime });
    };
    controller.interruptActiveTask = async (reason: string, scopeKey?: string) => {
      interrupts.push(`${scopeKey}:${reason}`);
      controller.activeInputs.delete(scopeKey);
      controller.activeTasks.get = () => undefined;
    };
    controller.activeTasks.get = () => ({ id: 7, cancelled: false, userId: 1 });
    controller.activeInputs.set("user:1", {
      taskId: 7,
      userId: 1,
      waitingTemplate: "",
      promptText: "Current user message:\n帮我评价一下",
      uploadedFiles: [],
      attachments: [],
      messageTime: "2026-04-06T00:00:00.000Z",
      updatedAt: Date.now(),
    });

    const restarted = await controller.restartActiveConversationIfMergeable(createCtx(11), { key: "user:1", label: "user 1" }, {
      promptText: "重点看最后一段",
      messageTime: "2026-04-06T00:00:01.000Z",
    });

    expect(restarted).toBe(true);
    expect(interrupts).toEqual(["user:1:merged follow-up input 11"]);
    expect(starts).toHaveLength(1);
    expect(starts[0]?.promptText).toContain("帮我评价一下");
    expect(starts[0]?.promptText).toContain("Follow-up user message in the same turn:\n重点看最后一段");
  });

  test("merges a late file into the active in-flight turn", async () => {
    const controller = createController() as any;
    const starts: Array<{ promptText: string; uploadedFiles: UploadedFile[]; attachments: AiAttachment[] }> = [];

    const uploaded = createUploadedFile("late.jpg");
    const attachment = createAttachment("late.jpg");

    controller.startConversationTask = (_ctx: Context, _waitingTemplate: string, promptText: string, uploadedFiles: UploadedFile[], attachments: AiAttachment[]) => {
      starts.push({ promptText, uploadedFiles, attachments });
    };
    controller.interruptActiveTask = async () => {
      controller.activeInputs.clear();
      controller.activeTasks.get = () => undefined;
    };
    controller.activeTasks.get = () => ({ id: 8, cancelled: false, userId: 1 });
    controller.activeInputs.set("user:1", {
      taskId: 8,
      userId: 1,
      waitingTemplate: "",
      promptText: "Current user message:\n怎么评价",
      uploadedFiles: [],
      attachments: [],
      messageTime: "2026-04-06T00:00:00.000Z",
      updatedAt: Date.now(),
    });

    const restarted = await controller.restartActiveConversationIfMergeable(createCtx(12), { key: "user:1", label: "user 1" }, {
      uploadedFiles: [uploaded],
      attachments: [attachment],
      messageTime: "2026-04-06T00:00:01.000Z",
    });

    expect(restarted).toBe(true);
    expect(starts).toHaveLength(1);
    expect(starts[0]?.promptText).toBe("Current user message:\n怎么评价");
    expect(starts[0]?.uploadedFiles).toEqual([uploaded]);
    expect(starts[0]?.attachments).toEqual([attachment]);
  });

  test("does not merge after the input window expires", async () => {
    const controller = createController() as any;
    const starts: unknown[] = [];

    controller.startConversationTask = () => {
      starts.push(true);
    };
    controller.interruptActiveTask = async () => {};
    controller.activeTasks.get = () => ({ id: 9, cancelled: false, userId: 1 });
    controller.activeInputs.set("user:1", {
      taskId: 9,
      userId: 1,
      waitingTemplate: "",
      promptText: "Current user message:\n第一句",
      uploadedFiles: [],
      attachments: [],
      messageTime: "2026-04-06T00:00:00.000Z",
      updatedAt: Date.now() - 4000,
    });

    const restarted = await controller.restartActiveConversationIfMergeable(createCtx(13), { key: "user:1", label: "user 1" }, {
      promptText: "第二句",
      messageTime: "2026-04-06T00:00:04.000Z",
    });

    expect(restarted).toBe(false);
    expect(starts).toHaveLength(0);
  });
});
