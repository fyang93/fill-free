import { describe, expect, test } from "bun:test";
import { buildProjectSystemPrompt, buildPrompt, buildAccessConstraintLines } from "../src/bot/ai/prompt";
import { extractAiTurnResultFromText, extractDirectTurnResultFromText, isDisplayableUserText, validateStructuredTurnResult } from "../src/bot/ai/response";
import { StructuredReasoner } from "../src/bot/ai/structured-reasoner";

describe("assistant prompt stability", () => {
  test("assistant system prompt prefers tools over prompt protocols", () => {
    const prompt = buildProjectSystemPrompt("模仿杀戮尖塔里的故障机器人说话。", "assistant");
    expect(prompt).toContain("You are the main assistant for a local-first Telegram bot.");
    expect(prompt).toContain("Use the runtime's native tool calling. Do not write fake tool calls");
    expect(prompt).toContain("Return one final user-visible reply for this turn after completing the needed work.");
    expect(prompt).toContain("Apply the configured persona directly in every user-visible reply for this turn");
    expect(prompt).toContain("Requester metadata is about the user, not you.");
    expect(prompt).toContain("Whenever the visible reply mentions a concrete time, date-time, or local clock time, include the timezone explicitly.");
    expect(prompt).toContain("Do not mention internal commands, shell usage, interface names, tool names, or implementation steps");
    expect(prompt).toContain("When looking for stored user files or document images, first search relevant markdown notes with keyword search and follow linked paths instead of guessing file locations from directory names alone.");
    expect(prompt).toContain("Respect the access constraints injected for this turn. Do not invent broader privacy prohibitions than those constraints.");
    expect(prompt).toContain("If the injected access constraints for this turn permit the requester to retrieve their own stored material, do not refuse on generic privacy grounds.");
    expect(prompt).toContain("When the user asks to send repository-local files to the current chat and the access rules allow it, return the relevant local file path references in the final reply so runtime-owned publication can send them.");
    expect(prompt).toContain("Do not refuse an allowed current-chat file send just because it is the current turn");
    expect(prompt).toContain("After you have already sent, saved, moved, or linked something, describe the confirmed outcome.");
    expect(prompt).toContain("When you have just saved, moved, or linked user-requested material in repository-local memory, briefly tell the user where it was stored.");
    expect(prompt).toContain("Never write, patch, or directly edit files under system/.");
    expect(prompt).toContain("canonical system-state mutations must go through repository CLI commands or dedicated deterministic mutation interfaces.");
    expect(prompt).toContain("模仿杀戮尖塔里的故障机器人说话");
    expect(prompt).toContain("Style for Telegram replies: 模仿杀戮尖塔里的故障机器人说话。");
    expect(prompt).toContain("Use the configured persona strongly and explicitly in the visible wording.");
    expect(prompt).toContain("Do not fall back to a generic assistant tone; keep the configured persona present throughout the reply.");
    expect(prompt).toContain("Even very short confirmations and list introductions must still reflect the configured style.");
  });

  test("maintainer prompt requires direct persona application", () => {
    const maintainer = buildProjectSystemPrompt("冷静、简洁、带一点稳定的机械感", "maintainer");
    expect(maintainer).toContain("Apply the configured persona directly in the maintenance summary");
    expect(maintainer).not.toContain("Whenever the visible summary mentions a concrete time, date-time, or local clock time, include the timezone explicitly.");
    expect(maintainer).toContain("Never write, patch, or directly edit files under system/.");
    expect(maintainer).toContain("Keep durable factual memory and broad preferences concise and well-organized.");
    expect(maintainer).toContain("This repository is multi-user: person-specific notes belong under the correct owner area, not broad top-level memory files.");
    expect(maintainer).toContain("When ownership becomes clear, consolidate provisional person notes into the canonical person location.");
    expect(maintainer).toContain("Keep memory organized by stable owner-first taxonomy: person material under memory/people, shared material under memory/shared, and repository-wide reference material under memory/common.");
    expect(maintainer).toContain("Visible style: 冷静、简洁、带一点稳定的机械感");
  });

  test("assistant turn prompt stays compact and user-visible", () => {
    const prompt = buildPrompt(
      "帮我查一下提醒",
      [],
      "Asia/Tokyo",
      "冷静、简洁、带一点稳定的机械感",
      undefined,
      "admin",
      undefined,
      "Asia/Tokyo",
    );
    expect(prompt).not.toContain("Requester access level: admin.");
    expect(prompt).toContain("Requester metadata is about the user, not the assistant.");
    expect(prompt).toContain("Whenever you mention a concrete time, date-time, or local clock time in the user-visible reply, include the timezone explicitly.");
    expect(prompt).toContain("Visible style: 冷静、简洁、带一点稳定的机械感");
    expect(prompt).toContain("Style for Telegram replies: 冷静、简洁、带一点稳定的机械感");
    expect(prompt).toContain("Answer the user directly.");
    expect(prompt).toContain("User request: 帮我查一下提醒");
  });

  test("access constraints are injected only when needed", () => {
    expect(buildAccessConstraintLines("admin")).toEqual([]);

    const trustedPrompt = buildPrompt("把用户2设为 trusted", [], "Asia/Tokyo", "", undefined, "trusted");
    expect(trustedPrompt).toContain("Requester access level: trusted.");
    expect(trustedPrompt).toContain("Do not help this requester change user access levels or add temporary authorizations.");

    const adminPrompt = buildPrompt("发一下我的证件图", [], "Asia/Tokyo", "", undefined, "admin");
    expect(adminPrompt).not.toContain("Requester access level: admin.");

    const allowedPrompt = buildPrompt("把用户2设为 trusted", [], "Asia/Tokyo", "", undefined, "allowed");
    expect(allowedPrompt).toContain("Requester access level: allowed.");
    expect(allowedPrompt).toContain("Keep the turn within allowed-user scope.");
    expect(allowedPrompt).toContain("Do not help this requester manage other users");
    expect(allowedPrompt).toContain("If the request needs a higher privilege, say so briefly instead of pretending it succeeded.");
  });

  test("assistant turn prompt injects requester-local time instead of raw utc", () => {
    const prompt = buildPrompt(
      "帮我查一下提醒",
      [],
      "Asia/Tokyo",
      "冷静、简洁、带一点稳定的机械感",
      "2026-04-05T16:51:25.000Z",
      "admin",
      undefined,
      "Asia/Tokyo",
    );

    expect(prompt).toContain("Requester-local time: 2026-04-06 01:51:25 (Asia/Tokyo).");
    expect(prompt).toContain("For schedule interpretation, treat relative dates/times like today, tomorrow, noon, and 3pm in the requester timezone Asia/Tokyo.");
    expect(prompt).toContain("When preparing schedule drafts, prefer requester-local date/time fields plus timezone. Do not convert to UTC in the model unless the user explicitly gave an absolute UTC/offset timestamp.");
    expect(prompt).not.toContain("Message time: 2026-04-05T16:51:25.000Z");
  });

  test("legacy turn parser rejects old answer-mode protocol blocks", () => {
    const parsed = extractAiTurnResultFromText('[response]\nanswer_mode: needs-clarification\nmessage: 请告诉我下午具体几点。\n[/response]');
    expect(parsed.message).toBe("");
  });

  test("plain text replies stay plain text", () => {
    const direct = extractDirectTurnResultFromText('我是故障机器人。');
    expect(direct.message).toBe("我是故障机器人。");
  });

  test("plain user-visible acknowledgments stay plain text", () => {
    const parsed = extractDirectTurnResultFromText('好的，我来把 @setsuna0808 添加到允许列表，请稍等。');
    expect(parsed.message).toContain("请稍等");
  });

  test("response parser rejects structured protocol-shaped output", () => {
    const parsed = extractAiTurnResultFromText('```json\n{\n  "answer_mode": "direct",\n  "message": "我是故障机器人。"\n}\n```');
    expect(parsed.message).toBe("");
  });

  test("response parser rejects mixed structured output with trailing tool-call leakage", () => {
    const parsed = extractAiTurnResultFromText('```json\n{\n  "answer_mode": "needs-execution",\n  "message": "让我检查一下你的提醒..."\n}\n```\n[TOOL_CALL]\n{tool => "read_file", args => { --path "/tmp/x" }}\n[/TOOL_CALL]');
    expect(parsed.message).toBe("");
    const parsedDirect = extractDirectTurnResultFromText('好的\n[TOOL_CALL]\n{tool => "read_file"}\n[/TOOL_CALL]');
    expect(parsedDirect.message).toBe("");
  });

  test("response parser rejects tagged structured output blocks", () => {
    const parsed = extractAiTurnResultFromText('[answer]\nmessage: ok\ndeliveries:\n  - content: 测试消息\n    recipient:\n      displayName: 锅巴之家\n[/answer]');
    expect(parsed.message).toBe("");
    expect(parsed.deliveries).toEqual([]);
    expect(validateStructuredTurnResult("anything", parsed)).toEqual([]);
  });

  test("displayable user text rejects tool-call markup", () => {
    expect(isDisplayableUserText('<invoke name="schedules"><parameter name="text">x</parameter></invoke></minimax:tool_call>')).toBe(false);
    expect(isDisplayableUserText('[TOOL_CALL]\n{tool => "read_file", args => { --path "/tmp/x" }}\n[/TOOL_CALL]')).toBe(false);
  });


  test("structured reasoner keeps clarification text without a separate answer mode", async () => {
    const reasoner = new StructuredReasoner(
      { bot: { defaultTimezone: "Asia/Tokyo", language: "zh-CN", personaStyle: "" } } as any,
      async () => ({
        message: "好的，等下是几点呢？给我一个具体时间，我帮你设好提醒。",
        files: [],
        attachments: [],
        fileWrites: [],
        schedules: [],
        deliveries: [],
        pendingAuthorizations: [],
        tasks: [],
      }),
      () => [],
    );

    const result = await reasoner.run("等下提醒我review论文");
    expect(result.message).toContain("具体时间");
  });
});
