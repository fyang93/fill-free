---
name: cli-schedules
description: Use when the task is primarily about creating, listing, updating, pausing, resuming, deleting, or interpreting reminders and scheduled tasks through the repository CLI.
---

# Schedules

Use this skill for reminder and schedule management.

## CLI surface

```bash
bun run repo:cli -- <command> '<json>'
```

Commands:
- `schedules:list`
- `schedules:get`
- `schedules:create`
- `schedules:update`
- `schedules:delete`
- `schedules:pause`
- `schedules:resume`

## Guidance

- Clarify only when a required field is truly missing.
- If the request is actionable but the time is vague, choose a reasonable local time and mention it briefly.
- For explicit dated events, prefer one-time schedules unless recurrence is requested.
- For birthdays, anniversaries, memorials, or festivals tied to a person, check local memory first if the date may already be recorded.
- Read first before mutating when the target schedule is ambiguous.
- Prefer `match.id` or another explicit target for update, pause, resume, and delete.
- Use requester-local time and timezone; do not pre-convert to UTC unless the user gave an absolute UTC or offset timestamp.
- Prefer requester-local projection fields when reading CLI results.
- Use semantic fields when needed:
  - birthday → `category: "special"`, `specialKind: "birthday"`
  - festival → `category: "special"`, `specialKind: "festival"`
  - anniversary → `category: "special"`, `specialKind: "anniversary"`
  - memorial → `category: "special"`, `specialKind: "memorial"`
- For recurring generated content, use `category: "scheduled-task"`.
- For create, keep payloads narrow: `title`, `schedule`, `timezone`, one target field, and optional semantic fields.
- Use `cli-rules` if the user is setting a standing future default rather than changing one schedule.
- Do not claim success unless the CLI call succeeded.

## Examples

```bash
bun run repo:cli -- schedules:list '{"requesterUserId":872940661}'
bun run repo:cli -- schedules:create '{"requesterUserId":872940661,"title":"组会","schedule":{"kind":"once","scheduledAt":"2026-04-28T10:00:00"},"timezone":"Asia/Tokyo","targetUserId":872940661}'
bun run repo:cli -- schedules:create '{"requesterUserId":872940661,"title":"小雨生日","schedule":{"kind":"yearly","every":1,"month":1,"day":22,"time":{"hour":8,"minute":0}},"timezone":"Asia/Tokyo","targetUserId":872940661,"category":"special","specialKind":"birthday"}'
bun run repo:cli -- schedules:create '{"requesterUserId":872940661,"title":"小雨农历生日","schedule":{"kind":"lunarYearly","month":5,"day":3,"time":{"hour":8,"minute":0}},"timezone":"Asia/Tokyo","targetUserId":872940661,"category":"special","specialKind":"birthday"}'
bun run repo:cli -- schedules:pause '{"requesterUserId":872940661,"match":{"id":"rmd_xxx"}}'
bun run repo:cli -- schedules:update '{"requesterUserId":872940661,"match":{"id":"rmd_xxx"},"changes":{"title":"新的标题"}}'
```