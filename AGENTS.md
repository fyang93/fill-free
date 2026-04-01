# Agent Instructions

This repository prefers a minimal-tool workflow.

- For read-only retrieval, prefer direct `fd`/`rg` and note body search first.
- Use the `memory-agent` skill for any request that would change repository memory or long-term files: remember, save, update, organize, merge, link, move from `tmp/` to `assets/`, or reshape existing notes.
- Use the `reminder-agent` skill for reminder-related requests: creating reminders, turning schedules/lists into reminders, recurring or event reminders, reminder interpretation/debugging, or mixed requests where reminders are one of the intended outcomes.
- For simple read-only questions about existing notes or assets, direct retrieval is fine; use `memory-agent` when note routing, merging, or persistence decisions are needed.
- When a user message may imply both long-term memory and reminders, use both `memory-agent` and `reminder-agent` as appropriate instead of treating them as separate unrelated flows.
- Do not claim that notes or files were saved, moved, merged, linked, or persisted unless the repository was actually updated.
