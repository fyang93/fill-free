---
name: cli-telegram
description: Use when the task is about resolving a Telegram recipient, sending an outbound message or file, or scheduling outbound delivery through the repository CLI.
---

# Telegram delivery

Use this skill for Telegram outbound delivery through the repository CLI.

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
- Use `telegram:send-message` for immediate outbound delivery.
- Use `telegram:send-file` only when a real repository file path exists.
- Use `telegram:schedule-message` for future delivery.
- Do not use this CLI path for runtime-owned current-turn reply publication to the same chat.
- For same-chat current-turn file replies, return local file path references so runtime can publish them.
- Do not fabricate recipient resolution.
- Do not claim success unless the CLI call succeeded.

## Examples

```bash
bun run repo:cli -- telegram:resolve-recipient '{"displayName":"锅巴之家"}'
bun run repo:cli -- telegram:send-message '{"requesterUserId":1,"recipientId":200,"recipientLabel":"Alice","content":"请查看今天的安排"}'
bun run repo:cli -- telegram:send-file '{"requesterUserId":1,"recipientKind":"user","recipientId":200,"recipientLabel":"Alice","filePath":"memory/people/alice/reports/daily.pdf","caption":"今日报告"}'
bun run repo:cli -- telegram:schedule-message '{"requesterUserId":1,"recipientKind":"chat","recipientId":-1001234567890,"recipientLabel":"项目群","content":"明早记得开会","sendAt":"2026-04-11T00:00:00.000Z"}'
```