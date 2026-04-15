---
name: cli-schedules
description: Use when the task is primarily about creating, listing, updating, pausing, resuming, deleting, or interpreting reminders and scheduled tasks through the repository CLI.
---

# Schedules

Use this skill when the main work is schedule management.

## Scope

This skill covers:

- listing reminders
- inspecting a specific schedule
- creating one-time reminders
- creating recurring reminders
- creating scheduled-task entries for generated recurring content
- updating an existing schedule
- pausing a schedule temporarily
- resuming a paused schedule
- deleting a schedule permanently

If the task is mainly about durable personal facts or preferences rather than schedule state, use the `memory` skill instead.

## CLI surface

Use the repository CLI through `bash`:

```bash
bun run repo:cli -- <command> '<json>'
```

Canonical schedule commands:

- `schedules:list`
- `schedules:get`
- `schedules:create`
- `schedules:update`
- `schedules:delete`
- `schedules:pause`
- `schedules:resume`

## Workflow

1. Clarify only if required fields are genuinely missing.
2. If the request is about a named person's birthday / anniversary / memorial / festival date reminder, inspect local memory first to resolve the stored date before asking again or constructing CLI arguments.
3. Prefer inspecting existing schedule state before mutating ambiguous requests.
4. For create/update/delete/pause/resume, prefer an inspect-first workflow whenever the target is not already explicit by id.
5. Execute the narrowest correct CLI action.
6. Base the final reply on the CLI's returned machine-readable result, not on the raw user request or title heuristics.

## Guidance

- For explicit dated events like `4月28日`, `Apr 28`, or `2026-04-28`, prefer one-time schedules unless recurrence is explicitly requested.
- For schedule interpretation and drafting, use requester-local date/time plus timezone.
- Do not pre-convert local reminder times to UTC in the model unless the user explicitly provided an absolute timestamp with `Z` or a numeric UTC offset.
- When reading schedule CLI results, prefer the requester-local projection fields returned by the CLI such as `scheduledAtRequesterLocal`, `currentOccurrence.scheduledAtRequesterLocal`, and `notificationsDetailed[*].notifyAtRequesterLocal` instead of inferring local time from raw UTC or generic summaries.
- Treat CLI payloads as deterministic command arguments, not as a place to invent broad persistence shapes. Name only the fields that code actually needs.
- Prefer intent-level decisions over title heuristics. Do not assume that a title containing “生日” is enough; set the semantic fields explicitly when the intent is birthday/festival/anniversary/memorial.
- For person-linked date reminders, memory-first is mandatory when the date may already be recorded locally. Search `memory/` first, then call the CLI with the resolved date. Do not stop after merely reporting the remembered date if the user's request was to create/update the reminder.
- Before `schedules:create` for birthdays and similar reminders, inspect the most relevant local memory note(s), determine whether the stored date is solar (`1996-01-22`, `1月22日`) or lunar (`农历五月初三`), then build the narrow CLI payload from that resolved fact.
- For temporary wording such as “先停一下”, “暂停”, or “下周再恢复”, prefer `schedules:pause` over delete.
- Distinguish current schedule mutation from future standing behavior. If the user also states a durable future-facing instruction about how schedule/reminder handling should work by default from now on, consider `cli-rules` in addition to the immediate schedule action.
- Do not mistake a one-off schedule change for a standing rule, and do not satisfy a clear standing default only by changing the current schedule.
- For explicit permanent removal wording, prefer `schedules:delete`.
- For recurring generated content such as daily news, weather, market summaries, or exchange-rate digests, create `category: "scheduled-task"` instead of a routine reminder.
- For special recurring reminders, always set semantic fields explicitly:
  - Birthday → `category: "special"`, `specialKind: "birthday"`
  - Festival/holiday → `category: "special"`, `specialKind: "festival"`
  - Anniversary → `category: "special"`, `specialKind: "anniversary"`
  - Memorial → `category: "special"`, `specialKind: "memorial"`
- For birthday-style reminders, prefer a yearly or lunarYearly schedule plus the special fields above. If notifications are omitted, repository code may apply default advance reminders; however, the special classification must be present for those defaults to apply.
- For create, provide only the narrow fields code needs:
  - `title`
  - `schedule`
  - `timezone`
  - exactly one target form: `targetUserId` or `targetChatId`
  - optional semantic fields: `category`, `specialKind`, `notifications`
- For mutation safety:
  - Prefer `match.id` / `scheduleId` for update, pause, resume, and delete when available.
  - If the user names a schedule loosely, inspect first with `schedules:list` or `schedules:get`, then mutate the explicit target.
  - Do not let a loose title-only match silently change multiple reminders when the target is not clearly unique.
- Important CLI payload fields for `schedules:create` and `schedules:update`:
  - `title`: human-readable reminder title
  - `schedule`: required object; e.g. `{"kind":"once","scheduledAt":"2026-04-28T10:00:00"}` or `{"kind":"yearly","every":1,"month":6,"day":1,"time":{"hour":8,"minute":0}}`
  - `timezone`: IANA timezone like `Asia/Tokyo`
  - `targetUserId` or `targetChatId`: reminder target
  - `category`: `routine` | `special` | `scheduled-task`
  - `specialKind`: `birthday` | `festival` | `anniversary` | `memorial`
  - `notifications`: optional array like `[{"id":"default-1d","offsetMinutes":-1440,"enabled":true,"label":"提前1天"}]`
- The final reply should describe only what the CLI result confirms. If the returned `schedule` still shows `category: "routine"`, do not claim it was corrected to birthday.
- Do not claim a schedule was created, changed, paused, resumed, or deleted unless the CLI command actually succeeded.

## Common examples

### List schedules

```bash
bun run repo:cli -- schedules:list '{"requesterUserId":872940661}'
```

You may also provide `match` to narrow the result set before interpreting times, for example by id, title, or scheduled date.

### Create a one-time reminder

```bash
bun run repo:cli -- schedules:create '{"requesterUserId":872940661,"title":"组会","schedule":{"kind":"once","scheduledAt":"2026-04-28T10:00:00"},"timezone":"Asia/Tokyo","targetUserId":872940661}'
```

### Create a birthday reminder from recorded memory

First inspect the relevant local memory note to resolve the stored birthday.

Then create the reminder using the resolved stored date:

```bash
bun run repo:cli -- schedules:create '{"requesterUserId":872940661,"title":"小雨生日","schedule":{"kind":"yearly","every":1,"month":1,"day":22,"time":{"hour":8,"minute":0}},"timezone":"Asia/Tokyo","targetUserId":872940661,"category":"special","specialKind":"birthday"}'
```

### Create a lunar birthday reminder

```bash
bun run repo:cli -- schedules:create '{"requesterUserId":872940661,"title":"小雨农历生日","schedule":{"kind":"lunarYearly","month":5,"day":3,"time":{"hour":8,"minute":0}},"timezone":"Asia/Tokyo","targetUserId":872940661,"category":"special","specialKind":"birthday"}'
```

### Pause a schedule by id

```bash
bun run repo:cli -- schedules:pause '{"requesterUserId":872940661,"match":{"id":"rmd_xxx"}}'
```

### Update a schedule title

```bash
bun run repo:cli -- schedules:update '{"requesterUserId":872940661,"match":{"id":"rmd_xxx"},"changes":{"title":"新的标题"}}'
```

### Correct a birthday reminder classification

```bash
bun run repo:cli -- schedules:update '{"requesterUserId":872940661,"match":{"id":"rmd_xxx"},"changes":{"category":"special","specialKind":"birthday"}}'
```

## Validation

- If a mutation target is ambiguous, inspect first instead of guessing.
- Keep replies separate from execution: runtime publishes the visible current-turn reply.
- After successful mutation, summarize the actual resulting state rather than restating the raw request.
