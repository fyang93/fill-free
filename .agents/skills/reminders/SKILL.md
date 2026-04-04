---
name: reminders
description: Use when the task involves creating, changing, reviewing, or reasoning about reminders, schedules, recurring events, or natural-language requests that may imply reminder creation.
---

# Reminders

Use this skill for reminder interpretation and reminder management.

## When to use

- The user asks to create, change, review, clarify, or delete reminders.
- The user gives dates, schedules, routines, birthdays, anniversaries, deadlines, meetings, or other event information that may need reminders.
- The user wants advance notice before an event or needs help deciding between one-time and recurring reminders.
- One message may imply both a reminder and some other follow-up action.

## Operating principles

- Prefer repository-local sources first for reminders, memory, files, logs, and project behavior.
- If habits, wording preferences, coordination defaults, or delivery preferences may matter, check local notes.
- Prefer narrowly scoped standing habits over broad defaults unless the user clearly wants a broad default.
- Distinguish absolute reminders from local-time reminders.
- Treat relative one-time requests like “in two hours” as absolute.
- Treat routines, birthdays, anniversaries, festivals, and memorials as local-time unless the user clearly anchors them to a fixed instant.
- For local reminders, consider timezone clues in this order: explicit timezone, clearly known event-subject timezone, reminder recipient timezone, requester timezone, then system default.
- Only use subject timezone when local evidence clearly supports it.
- Let the model handle intent extraction and ambiguity.
- Let code own reminder defaults, validation, normalization, timezone memory, and persistence.
- Prefer the smallest sufficient clarification.
- Inspect raw reminder storage only for debugging or low-level reminder maintenance.

## Boundary with memory

- Do not create or rewrite memory notes just to mirror reminder storage.
- Use `memory/` only when the user also wants a durable fact, preference, or long-term context remembered beyond the reminder itself.
- Keep reminder scheduling in reminder data, and keep long-term human-readable context in `memory/`.
