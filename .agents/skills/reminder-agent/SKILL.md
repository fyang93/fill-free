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

## Notes

- For birthdays and anniversaries, prefer creating multiple reminders around one month before, one week before, one day before, and on the day itself.
- Reminders are stored as JSON in `memory/reminders.json`.
- `jq` is available in this environment for inspecting or transforming reminder JSON when needed.
