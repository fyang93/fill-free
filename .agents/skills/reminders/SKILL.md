---
name: reminders
description: Use when the task involves creating, changing, reviewing, or reasoning about reminders, schedules, recurring events, or natural-language requests that may imply reminder creation.
---

# Reminders

Use this skill for reminder interpretation and reminder management.

## When to Use

- The user asks to create, change, review, clarify, or delete reminders.
- The user gives dates, schedules, routines, birthdays, anniversaries, deadlines, meetings, or other event information that may need reminders.
- The user wants advance notice before an event or needs help deciding between one-time and recurring reminders.
- One message may imply both a reminder and some other follow-up action.

## Operating Principles

- Prefer repository-local sources first for reminders, user memory, files, logs, and project behavior.
- If wording, reminder timing habits, coordination defaults, or delivery preferences may matter, check `system/rules.json` first, then `memory/preferences/` notes if needed.
- For reminder-related standing habits, prefer task-scoped or narrowly targeted rules over broad global rules unless the user clearly intends a broad default.
- Distinguish absolute reminders from local-time reminders.
- Treat relative one-time requests like “in two hours” as absolute. Treat routine schedules, birthdays, anniversaries, festivals, and memorials as local unless the user clearly anchors them to a fixed instant.
- For local reminders, consider timezone clues in this order: explicit timezone from the user, clearly known event-subject timezone, reminder recipient timezone, requester timezone, then system default.
- Only use subject timezone when it is clearly supported by repository-local evidence. Do not invent timezone from weak identity assumptions.
- If local evidence clearly supports an event-subject timezone, include `subjectTimezone` in the reminder draft.
- Let the model handle intent extraction and ambiguity: event kind, schedule shape, offsets, timezone clues, and whether clarification is necessary.
- Let code own reminder defaults, validation, normalization, timezone memory, and persistence.
- Prefer the smallest sufficient clarification. Ask only when the reminder cannot yet be represented safely.
- Inspect raw reminder storage only for debugging or low-level reminder maintenance.

## Boundary With Memory

- Do not create or rewrite markdown memory notes just to mirror reminder storage.
- Use `memory/` only when the user also wants a durable fact, preference, or long-term context remembered beyond the reminder itself.
- Keep reminder scheduling in reminder data, and keep long-term human-readable context in `memory/`.
