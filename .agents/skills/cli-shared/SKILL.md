---
name: cli-shared
description: Use when work needs the repository CLI as a deterministic execution surface, or when you need to identify which command family or domain skill applies.
---

# Repo CLI

Use this skill as the shared entrypoint for repository-local deterministic execution.

## Role

This skill is the shared/base CLI guide.
It explains:

- how to invoke the repository CLI
- which command family fits the task
- when to load a more specific domain skill

It does not replace domain skills such as `cli-schedules`, `cli-telegram`, `cli-access`, or `memory`.

## Runtime boundary

- The runtime owns current-turn visible reply publication.
- The repository CLI executes deterministic local operations.
- After CLI work succeeds, return a concise factual reply; do not fake execution.
- If work will take noticeable time, rely on the runtime-owned current-turn ack/progress path rather than sending your own current-turn ack/progress message.

## CLI entrypoint

Primary form:

```bash
bun run repo:cli -- <command> '<json>'
```

Equivalent direct form:

```bash
bun run src/cli.ts <command> '<json>'
```

Use `bash` to execute it.

## Command families

### schedules:*

- `schedules:list`
- `schedules:get`
- `schedules:create`
- `schedules:update`
- `schedules:delete`
- `schedules:pause`
- `schedules:resume`

Load `cli-schedules` when the task is mainly about reminders, recurring schedules, or scheduled-task creation.

### users:* and auth:*

- `users:list`
- `users:get`
- `users:set-access`
- `users:set-timezone`
- `users:add-rule`
- `users:set-rules`
- `auth:add-pending`

Load `cli-access` when the task is mainly about user records, access levels, or temporary authorization.

### telegram:*

- `telegram:resolve-recipient`
- `telegram:send-message`
- `telegram:send-file`
- `telegram:schedule-message`

Load `cli-telegram` when the task is mainly about outbound Telegram delivery.

## Shared rules

- Use canonical command names only.
- Keep canonical truth in structured state, not prose.
- Do not claim anything was created, changed, sent, or scheduled unless the CLI command actually succeeded.
- Use native file/shell/search/edit capabilities freely around the CLI when inspection or preparation is needed.
- If the task is mainly about durable notes or preferences rather than structured operational state, use `memory` instead of forcing the CLI.
- Do not use the CLI to publish current-turn ack/progress messages; runtime handles that path.
