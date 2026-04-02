---
name: reminder-agent
description: Use for reminder planning, reminder extraction from natural language, recurring/event reminder decisions, and cases where one user message may imply both reminders and other follow-up actions.
---

# Reminder Agent

Use this skill when the user asks to create, change, review, clarify, or reason about reminders, schedules, recurring events, or reminder-oriented automation.

## When to Use This Skill

Use this skill when the user:

- Asks to create one or more reminders
- Gives a list or schedule that should become reminders
- Mentions birthdays, anniversaries, memorials, festivals, meetings, deadlines, appointments, or routines that may need reminders
- Wants reminders before an event
- Needs help deciding whether something should be a one-time, recurring, or event-style reminder
- Wants reminder behavior changed, simplified, debugged, or reviewed
- Gives a mixed request where reminders may be only part of the intended outcome

## Operating Principles

- Prefer repository-local sources first for reminders, user memory, project behavior, files, and logs. Check repository data before relying on outside assumptions.
- Let the model do intent extraction and ambiguity handling: identify event kind, schedule shape, user-requested reminder offsets, timezone clues, and whether a follow-up question is necessary.
- Let code own defaults, validation, normalization, timezone memory, and persistence. Do not invent complex reminder structures in prompt text when deterministic code can derive them.
- Apply product defaults only when the user did not specify reminders:
  - meetings: default to 1 hour before
  - birthday / anniversary: default to 2 weeks, 1 week, 1 day, and same day
  - birthday reminders default to notifying relevant caregivers, family members, or the requester, not the birthday person themself, unless the user explicitly asks to remind that person
  - routine daily/weekly/monthly reminders: default to same-time only
- Prefer the smallest sufficient clarification. Ask only when a reminder cannot be safely represented yet.
- Only inspect raw reminder storage when debugging or low-level reminder maintenance truly requires it.
- `jq` is available when raw reminder JSON inspection is necessary.
