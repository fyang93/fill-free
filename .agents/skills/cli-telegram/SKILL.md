---
name: cli-telegram
description: Use when the task is about resolving a Telegram recipient, sending an outbound message or file, or scheduling outbound delivery through the repository CLI.
---

# Telegram delivery

Use this skill when the main task is Telegram delivery through the repository CLI, including outbound delivery and scheduled delivery.

## Scope

This skill covers:

- resolving a chat or user recipient
- sending an outbound message
- sending an outbound file
- scheduling a future outbound message

This skill is **not** for the final current-turn assistant reply or current-turn ack/progress publication. Runtime publishes those paths directly.

## CLI surface

Use the repository CLI through `bash`:

```bash
bun run repo:cli -- <command> '<json>'
```

Canonical commands:

- `telegram:resolve-recipient`
- `telegram:send-message`
- `telegram:send-file`
- `telegram:schedule-message`

## Workflow

1. Decide whether the user wants immediate outbound delivery or scheduled delivery.
2. Resolve the recipient first if the target is ambiguous.
3. Execute the narrowest delivery command.
4. Return a concise confirmation only after the CLI call succeeds.

## Guidance

- Use `telegram:resolve-recipient` when the request names a person or chat loosely by display name or username.
- Use `telegram:send-message` for outbound delivery to a specific chat or user.
- Do not use `telegram:send-message` as a substitute for the final current-turn assistant reply or runtime-owned current-turn ack/progress.
- Use `recipientId` for direct delivery.
- Use `telegram:send-file` only when a real file path exists inside the repository.
- Use `telegram:schedule-message` when the user explicitly wants future delivery.
- Do not claim a message or file was sent unless the CLI command actually succeeded.
- Do not fabricate recipient resolution. If the result is ambiguous or not found, say so and ask the user to clarify.

## Common examples

### Resolve a recipient

```bash
bun run repo:cli -- telegram:resolve-recipient '{"displayName":"锅巴之家"}'
```

### Send a message

```bash
bun run repo:cli -- telegram:send-message '{"requesterUserId":1,"recipientId":200,"recipientLabel":"Alice","content":"请查看今天的安排"}'
```

### Send a file

```bash
bun run repo:cli -- telegram:send-file '{"requesterUserId":1,"recipientKind":"user","recipientId":200,"recipientLabel":"Alice","filePath":"assets/reports/daily.pdf","caption":"今日报告"}'
```

### Schedule a message

```bash
bun run repo:cli -- telegram:schedule-message '{"requesterUserId":1,"recipientKind":"chat","recipientId":-1001234567890,"recipientLabel":"项目群","content":"明早记得开会","sendAt":"2026-04-11T00:00:00.000Z"}'
```

## Validation

- Resolve ambiguous recipients before delivery.
- Keep outbound delivery confirmation separate from runtime-owned final current-turn reply publication.
- Current-turn ack/progress publication belongs to runtime, not this CLI skill.
- If a file path is referenced, verify it exists and is inside the repository before claiming success.
