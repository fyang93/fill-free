---
name: cli-access
description: Use when the task is about repository-stored user access, user identity records, or temporary authorization state through the repository CLI.
---

# Access control

Use this skill for access changes, user identity lookup, and pending authorization state.

## CLI surface

```bash
bun run repo:cli -- <command> '<json>'
```

Commands:
- `users:list`
- `users:get`
- `users:set-access`
- `users:set-person-path`
- `auth:add-pending`

## Guidance

- Read first when the target user is unclear.
- Mutate only one explicit target.
- Use `users:list` for overview questions.
- Use `users:get` for one specific identity.
- Use `users:set-access` for grant, reduce, or clear.
- Use `users:set-person-path` only for one explicit Telegram user and one explicit canonical person entry.
- Use `auth:add-pending` for temporary authorization state.
- Use `cli-rules` for durable assistant rules.
- Use `memory` for durable facts or preferences.
- Do not claim success unless the CLI call succeeded.

## Examples

```bash
bun run repo:cli -- users:list '{"requesterUserId":1}'
bun run repo:cli -- users:get '{"requesterUserId":1,"userId":200}'
bun run repo:cli -- users:set-access '{"requesterUserId":1,"userId":200,"accessLevel":"trusted"}'
bun run repo:cli -- users:set-access '{"requesterUserId":1,"userId":200,"accessLevel":"clear"}'
bun run repo:cli -- users:set-person-path '{"requesterUserId":1,"userId":200,"personPath":"memory/people/alice/README.md"}'
bun run repo:cli -- auth:add-pending '{"requesterUserId":1,"username":"new_user","createdBy":1}'
```