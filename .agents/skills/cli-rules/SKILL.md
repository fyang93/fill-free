---
name: cli-rules
description: Use when the task is about adding, replacing, or interpreting structured per-user assistant rules through the repository CLI.
---

# Assistant rules

Use this skill when the main task is a standing assistant rule such as "以后都要…", "今后请遵守…", or another durable per-user instruction that should go through the structured rule CLI path.

## Scope

This skill covers:

- adding one reusable per-user assistant rule
- replacing the full per-user assistant rule list deterministically
- inspecting a stored user record when needed before rule mutation
- interpreting or summarizing currently stored per-user assistant rules

It is not for access-level changes, temporary authorization, Telegram delivery, or ordinary factual memory retrieval.

## CLI surface

Use the repository CLI through `bash`:

```bash
bun run repo:cli -- <command> '<json>'
```

Relevant commands:

- `users:get`
- `users:add-rule`
- `users:set-rules`

## Workflow

1. Decide whether the user is expressing one new standing rule or asking to replace/review existing rules.
2. If the target user is ambiguous, inspect first or ask.
3. Prefer a short reusable rule summary over copying a long transcript literally.
4. Use `users:add-rule` for one incremental standing rule.
5. Use `users:set-rules` only when the request clearly intends full replacement.
6. Return a concise factual summary only after the CLI command succeeds.

## Guidance

- Good rule text is short, reusable, and future-facing.
- Prefer rule summaries like `添加组会提醒时默认设置为提前1天、提前2小时、提前1小时` instead of copying an entire conversation turn.
- If the request is mainly about durable factual memory or broad personal preferences rather than a deterministic standing assistant rule, use `memory` instead.
- Do not claim the rule was added or replaced unless the CLI command actually succeeded.

## Common examples

### Inspect one user's current rules

```bash
bun run repo:cli -- users:get '{"requesterUserId":1,"userId":200}'
```

### Add one assistant rule

```bash
bun run repo:cli -- users:add-rule '{"requesterUserId":1,"userId":200,"rule":"添加组会提醒时默认设置为提前1天、提前2小时、提前1小时"}'
```

### Replace the full assistant rule list

```bash
bun run repo:cli -- users:set-rules '{"requesterUserId":1,"userId":200,"rules":["先查本地记忆再回答","添加组会提醒时默认设置为提前1天、提前2小时、提前1小时"]}'
```

## Validation

- Prefer exact user targeting before mutation.
- If identity is unclear, inspect first instead of guessing.
- Runtime owns visible current-turn reply publication; CLI commands only mutate or read repository-local state.
