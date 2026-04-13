---
name: cli-access
description: Use when the task is about repository-stored user access, user identity records, or temporary authorization state through the repository CLI.
---

# Access control

Use this skill when the task is primarily about who has access, what user record is stored locally, or whether temporary authorization should be created or changed.

## Scope

This skill covers:

- listing known users
- inspecting a stored user record
- changing access level
- changing stored timezone
- adding or replacing per-user assistant rules
- adding pending authorization state

It is not for current-turn reply publication and it is not for Telegram outbound delivery.

## CLI surface

Use the repository CLI through `bash`:

```bash
bun run repo:cli -- <command> '<json>'
```

Relevant command families:

- `users:list`
- `users:get`
- `users:set-access`
- `users:set-timezone`
- `users:add-rule`
- `users:set-rules`
- `auth:add-pending`

## Workflow

1. Decide whether the task is read-only or mutating.
2. If the target user is ambiguous, inspect first or ask.
3. Run the narrowest possible CLI command.
4. Return a concise factual summary after the CLI command succeeds.

## Guidance

- Use `users:list` for overview questions.
- Use `users:get` when one specific identity must be inspected.
- Use `users:set-access` for granting, reducing, or clearing stored access overrides.
- Use `users:set-timezone` when updating only the stored timezone.
- Use `users:add-rule` when the user expresses one new durable assistant-behavior rule and the intended short reusable rule text is clear.
- Use `users:set-rules` when replacing the full per-user assistant rule list deterministically.
- Use `auth:add-pending` for temporary authorization flows represented in runtime state.
- Prefer concise reusable rule summaries, not verbatim long quotes. Rules should capture durable assistant behavior for that user, e.g. “先查本地记忆再回答” rather than a transcript fragment.
- Do not promise access changes or authorization changes unless the CLI call actually succeeded.
- Keep permission hard constraints in code and runtime; this skill only guides the execution workflow.

## Common examples

### List users

```bash
bun run repo:cli -- users:list '{"requesterUserId":1}'
```

### Inspect one user

```bash
bun run repo:cli -- users:get '{"requesterUserId":1,"userId":200}'
```

### Promote a user to trusted

```bash
bun run repo:cli -- users:set-access '{"requesterUserId":1,"userId":200,"accessLevel":"trusted"}'
```

### Clear an access override

```bash
bun run repo:cli -- users:set-access '{"requesterUserId":1,"userId":200,"accessLevel":"clear"}'
```

### Set timezone

```bash
bun run repo:cli -- users:set-timezone '{"requesterUserId":1,"userId":200,"timezone":"Asia/Tokyo"}'
```

### Add one assistant rule

```bash
bun run repo:cli -- users:add-rule '{"requesterUserId":1,"userId":200,"rule":"先查本地记忆再回答"}'
```

### Replace the full assistant rule list

```bash
bun run repo:cli -- users:set-rules '{"requesterUserId":1,"userId":200,"rules":["先查本地记忆再回答","遇到生日提醒先查记忆库"]}'
```

### Add pending authorization

```bash
bun run repo:cli -- auth:add-pending '{"requesterUserId":1,"username":"new_user","createdBy":1}'
```

## Validation

- Prefer exact user targeting before mutation.
- If identity is unclear, inspect first instead of guessing.
- Runtime owns visible current-turn reply publication; CLI commands only mutate or read repository-local state.
