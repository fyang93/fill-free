---
name: memory
description: Use when the task involves retrieving, saving, updating, merging, or organizing long-term repository memory, notes, files, or persistent user information.
---

# Memory

Use this skill when the user asks to remember, save, update, organize, merge, link, or retrieve long-term information from this repository. Use it especially for fact questions about what is known, remembered, recorded, or saved about a person, chat, reminder, file, preference, or other persistent repository state.

## Retrieval

- Prefer repository-local sources first for user memory, reminders, personal facts, files, logs, and project behavior.
- For fact questions, first check repository-local memory and state before relying on conversation context, rough recollection, or external search.
- This includes questions about who the current user is, what name is recorded for them, what is remembered about them, whether a fact was saved, and what habits, preferences, reminders, or files are already recorded.
- Check `memory/`, `assets/`, `system/`, and relevant code/logs before considering external search.
- For reminder, relay, coordination, naming, or administrator-habit questions, check `memory/preferences.md` early.
- Use web search only when local sources are insufficient for the question.
- Treat frontmatter as lightweight support only. Keep it minimal and use it for `title`, `aliases`, `summary`, and sparse `tags`, not as the primary retrieval path.

## Note Routing

- All long-term markdown notes must live under `memory/`.
- Treat `system/` as code-managed persistent data rather than general-purpose notes. Do not move ordinary memory there or casually rewrite files there unless the task is explicitly about system-managed data.
- Merge related information into an existing topic note whenever it clearly fits. Keep each markdown file focused on one stable topic.
- Preferences about wording, reminders, coordination, or delivery habits belong in `memory/preferences.md`.
- Create a new note only when the information represents a distinct long-lived topic that does not fit an existing note.
- If new information conflicts with an existing note, update only when the intended replacement is clear; otherwise ask the user.

## Files

- If a file from `tmp/` should be kept long-term, persist the real file under `assets/` first, organize it into a sensible subdirectory, and give it a clear filename.
- Link the real asset path from the relevant markdown. Do not use markdown placeholder files under `assets/` instead of the real uploaded file.
- After successful persistence, clean up the old `tmp/` file unless the user clearly asked to keep it.

## Sensitive Data

- There is no separate local-secret workflow in this repository; persisted data may enter AI context.
- Passwords may be persisted when the user clearly and explicitly asks to save them.
- Never persist API keys, private keys, recovery codes, seed phrases, session tokens, 2FA backup codes, or CVV.
- For other highly sensitive values such as ID numbers, passport numbers, residence card numbers, bank card numbers, full addresses, or phone numbers, warn briefly first and ask for confirmation before storing unless the user has already clearly and explicitly asked to persist them.
- If the user insists on storing sensitive values that are not in the never-store list, do the minimum necessary and avoid repeating the raw value unless required.

## Validation

- Do not claim something was saved, moved, merged, linked, or persisted unless the repository was actually updated.
- After making changes, quickly verify that referenced files exist and markdown links point to the real asset path.
