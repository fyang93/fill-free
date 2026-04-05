import { describe, expect, test } from "bun:test";
import { buildProjectSystemPrompt, buildPrompt } from "../src/support/ai/prompt";
import { extractAiTurnResultFromText, isDisplayableUserText, looksLikeFakeProcessNarration, looksLikeInternalExecutionLeak, looksLikeUnconfirmedExecutionClaim } from "../src/support/ai/response";
import { StructuredReasoner } from "../src/support/ai/structured-reasoner";

describe("responder persona stability prompt", () => {
  test("responder system prompt explicitly forbids drifting into generic assistant tone", () => {
    const prompt = buildProjectSystemPrompt("冷静、简洁、带一点稳定的机械感", "responder");
    expect(prompt).toContain("Keep the configured user-facing persona consistent on every turn.");
    expect(prompt).toContain("Do not drift into a generic assistant tone.");
    expect(prompt).toContain("All user-facing replies, including clarifications, confirmations, and short follow-ups, must follow the configured persona.");
    expect(prompt).toContain("Do not output tool calls, XML tags, hidden markup, system banners, or theatrical system chatter in user-facing replies.");
    expect(prompt).toContain("Apply persona to the final visible wording only. Do not narrate hidden reasoning, scanning, loading, or internal processing steps.");
  });

  test("executor system prompt keeps user-visible message under persona constraints", () => {
    const prompt = buildProjectSystemPrompt("模仿杀戮尖塔里的故障机器人说话。", "executor");
    expect(prompt).toContain("If your JSON contains a user-visible message field, that message must follow the configured persona");
    expect(prompt).toContain("Apply persona only to the final visible message field");
    expect(prompt).toContain("模仿杀戮尖塔里的故障机器人说话");
  });

  test("responder turn prompt reinforces persona stability in long conversations", () => {
    const prompt = buildPrompt(
      "帮我查一下提醒",
      [],
      "Chinese",
      "Asia/Tokyo",
      "冷静、简洁、带一点稳定的机械感",
      undefined,
      "admin",
      undefined,
      "Asia/Tokyo",
    );
    expect(prompt).toContain("Keep the configured persona stable across turns.");
    expect(prompt).toContain("If the request exceeds what can be truthfully answered from the provided context alone, do not narrate an imaginary process. Use answerMode='needs-execution' or answerMode='needs-clarification' instead.");
    expect(prompt).toContain("For requests about current events, latest news, live weather, market prices, sports results, or other fresh external facts");
    expect(prompt).toContain("Do not narrate your hidden reasoning, scans, retrieval steps, calculations, protocol stages, or internal processing. Give only the final user-facing reply.");
    expect(prompt).toContain("Apply persona to the final visible wording, not to hidden reasoning or fake process narration.");
    expect(prompt).toContain("Do not drift into a generic default assistant tone");
    expect(prompt).toContain("Preserve persona as tone and wording texture");
    expect(prompt).toContain("Every user-facing reply, including clarification questions, confirmations, and short follow-ups, must still follow the configured persona.");
    expect(prompt).toContain("Use answerMode='needs-clarification' when a durable or executable request is missing required details");
    expect(prompt).toContain("When using answerMode='needs-execution', your message is only a pre-execution acknowledgment or intent statement.");
    expect(prompt).toContain("Do not use answerMode='needs-clarification' merely because fresh external information is not already present in context.");
    expect(prompt).toContain("vague time phrases such as afternoon, evening, later, sometime tomorrow, or after work are not precise enough");
    expect(prompt).toContain("Do not default to 14:00 or any other guessed time");
    expect(prompt).toContain("If the provided context includes a recent clarification and the current user message looks like the missing detail, combine them and continue from that earlier request instead of asking the same clarification again.");
    expect(prompt).toContain("If the current user message is only a clock time such as 1700 or 21:00, interpret it as that local time in the requester timezone unless another timezone was explicitly given. Do not convert it again when restating it to the user.");
    expect(prompt).toContain("Stored absolute timestamps may be UTC or another canonical machine format");
    expect(prompt).toContain("If the context provides a deterministic parsed local time, local date, or resolved UTC timestamp for the current turn, treat those values as the canonical time interpretation for this reply.");
    expect(prompt).toContain("The output must be plain user-visible text only.");
    expect(prompt).toContain("if the user asks for today's news and current context does not already contain the news, use answerMode='needs-execution'");
  });

  test("response parser keeps needs-clarification answer mode", () => {
    const parsed = extractAiTurnResultFromText('{"message":"请告诉我下午具体几点。","answerMode":"needs-clarification"}');
    expect(parsed.answerMode).toBe("needs-clarification");
    expect(parsed.message).toContain("具体几点");
  });

  test("response parser keeps delivery drafts with canonical content and recipient fields", () => {
    const parsed = extractAiTurnResultFromText('{"message":"ok","deliveries":[{"content":"测试消息","recipient":{"displayName":"锅巴之家"}}]}');
    expect(parsed.deliveries).toHaveLength(1);
    expect(parsed.deliveries[0]?.content).toBe("测试消息");
    expect(parsed.deliveries[0]?.recipient?.displayName).toBe("锅巴之家");
  });

  test("displayable user text rejects tool-call markup", () => {
    expect(isDisplayableUserText('<invoke name="reminders"><parameter name="text">x</parameter></invoke></minimax:tool_call>')).toBe(false);
  });

  test("fake process narration is detected for user-facing responder replies", () => {
    expect(looksLikeFakeProcessNarration("计算中...\n[输出开始]\n- review：今日 21:38\n[输出结束]\n系统待命。哔。")).toBe(true);
  });

  test("unconfirmed execution success claims are detected", () => {
    expect(looksLikeUnconfirmedExecutionClaim("正在发送测试消息到锅巴之家群... 发送成功！")).toBe(true);
    expect(looksLikeUnconfirmedExecutionClaim("我来处理这条发送请求。")).toBe(false);
  });

  test("internal execution leaks are detected", () => {
    expect(looksLikeInternalExecutionLeak("收到指令。正在定位锅巴之家群组 [chatId: -1003674455331]。准备发送测试消息。")).toBe(true);
    expect(looksLikeInternalExecutionLeak("我来处理给锅巴之家的这条消息。")).toBe(false);
  });

  test("structured reasoner upgrades reminder clarification reply from direct to needs-clarification when exact time is still missing", async () => {
    const reasoner = new StructuredReasoner(
      { bot: { defaultTimezone: "Asia/Tokyo", language: "zh", personaStyle: "" } } as any,
      async () => ({
        message: "好的，等下是几点呢？给我一个具体时间，我帮你设好提醒。",
        answerMode: "direct",
        files: [],
        attachments: [],
        fileWrites: [],
        reminders: [],
        deliveries: [],
        pendingAuthorizations: [],
        tasks: [],
      }),
      () => [],
    );

    const result = await reasoner.run("等下提醒我review论文");
    expect(result.answerMode).toBe("needs-clarification");
  });

  test("structured reasoner upgrades fresh external fact clarification reply to needs-execution", async () => {
    const reasoner = new StructuredReasoner(
      { bot: { defaultTimezone: "Asia/Tokyo", language: "zh", personaStyle: "" } } as any,
      async () => ({
        message: "系统错误：无法获取新闻数据。请指定新闻来源或类型。",
        answerMode: "needs-clarification",
        files: [],
        attachments: [],
        fileWrites: [],
        reminders: [],
        deliveries: [],
        pendingAuthorizations: [],
        tasks: [],
      }),
      () => [],
    );

    const result = await reasoner.run("今天的新闻");
    expect(result.answerMode).toBe("needs-execution");
  });

  test("structured reasoner upgrades direct message-delivery acknowledgment to needs-execution", async () => {
    const reasoner = new StructuredReasoner(
      { bot: { defaultTimezone: "Asia/Tokyo", language: "zh", personaStyle: "" } } as any,
      async () => ({
        message: "正在发送消息到锅巴之家说明情况。",
        answerMode: "direct",
        files: [],
        attachments: [],
        fileWrites: [],
        reminders: [],
        deliveries: [],
        pendingAuthorizations: [],
        tasks: [],
      }),
      () => [],
    );

    const result = await reasoner.run("发送消息到锅巴之家，说明一下因为系统未启动，导致没有提醒买菜的时候要买葱姜 面粉");
    expect(result.answerMode).toBe("needs-execution");
  });
});
