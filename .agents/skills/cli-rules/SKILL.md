---
name: cli-rules
description: Use when the task is about adding, replacing, or interpreting structured per-user assistant rules through the repository CLI.
---

# Assistant rules

Use this skill for durable per-user assistant rules like “以后都要…” or “今后请遵守…”.

## CLI surface

```bash
bun run repo:cli -- <command> '<json>'
```

Commands:
- `users:get`
- `users:add-rule`
- `users:set-rules`

## Guidance

- Prefer short, reusable, future-facing rule text.
- Use `users:add-rule` for one new rule.
- Use `users:set-rules` only for clear full replacement.
- Read first when the target user is unclear.
- Use `memory` for ordinary facts or preferences.
- Do not claim success unless the CLI call succeeded.

## Examples

```bash
bun run repo:cli -- users:get '{"requesterUserId":1,"userId":200}'
bun run repo:cli -- users:add-rule '{"requesterUserId":1,"userId":200,"rule":"添加组会提醒时默认设置为提前1天、提前2小时、提前1小时"}'
bun run repo:cli -- users:set-rules '{"requesterUserId":1,"userId":200,"rules":["先查本地记忆再回答","添加组会提醒时默认设置为提前1天、提前2小时、提前1小时"]}'
```