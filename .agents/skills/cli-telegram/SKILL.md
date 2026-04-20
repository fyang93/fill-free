---
name: cli-telegram
description: Use when the task is about resolving a Telegram recipient, sending a Telegram message or file, or scheduling Telegram delivery through the repository CLI.
---

# Telegram delivery

Use this skill for deterministic Telegram delivery through the repository CLI.

## CLI surface

```bash
bun run repo:cli -- <command> '<json>'
```

Commands:
- `telegram:resolve-recipient`
- `telegram:send-message`
- `telegram:send-file`
- `telegram:schedule-message`

## Guidance

- Resolve the recipient first when the target is ambiguous.
- Use `telegram:send-message` for immediate Telegram delivery when the target is known.
- Use `telegram:send-file` only when a real repository file path exists.
- Use `telegram:schedule-message` for future delivery.
- Principle: default Telegram publication to the current conversation. If the user is talking to the bot here, replies and returned files should default here unless the user explicitly asked for a different recipient.
- The runtime already owns ordinary current-turn final reply publication. Do not use `telegram:send-message` merely to duplicate the same final reply text to the same current chat/user.
- Message/file delivery is still not outbound-only: use this shared Telegram delivery capability when the task truly requires an actual Telegram send event beyond the runtime's ordinary final reply publication.
- Same-chat current-turn file return may still need this skill when the user expects the file to be actually sent in Telegram rather than only referenced in text.
- For same-turn file return or extra delivery, the current chat is the default recipient unless the user explicitly asked for some other target.
- In groups/supergroups, do not silently switch a same-turn returned file or extra delivery to the requester's private chat unless the user explicitly asked for a private delivery.
- Extra same-chat messages are acceptable when the workflow genuinely benefits from them, but avoid duplicate chatter and do not fight the runtime's waiting/progress behavior.
- Do not stop at mentioning a local file path in text when the user clearly expects the file to be sent in Telegram.
- Do not fabricate recipient resolution.
- Do not claim success unless the CLI call succeeded.

## Examples

```bash
bun run repo:cli -- telegram:resolve-recipient '{"displayName":"锅巴之家"}'
bun run repo:cli -- telegram:send-message '{"requesterUserId":1,"recipientId":200,"recipientLabel":"Alice","content":"请查看今天的安排"}'
bun run repo:cli -- telegram:send-file '{"requesterUserId":1,"recipientKind":"chat","recipientId":-1003674455331,"recipientLabel":"锅巴之家","filePath":"tmp/telegram/2026-04-20/YANG_FAN_研究業務日誌（2026.4）.xlsx","caption":"已填好的研究业务日志"}'
bun run repo:cli -- telegram:send-file '{"requesterUserId":1,"recipientKind":"user","recipientId":200,"recipientLabel":"Alice","filePath":"memory/people/alice/reports/daily.pdf","caption":"今日报告"}'
bun run repo:cli -- telegram:schedule-message '{"requesterUserId":1,"recipientKind":"chat","recipientId":-1001234567890,"recipientLabel":"项目群","content":"明早记得开会","sendAt":"2026-04-11T00:00:00.000Z"}'
```
