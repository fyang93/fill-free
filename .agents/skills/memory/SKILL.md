---
name: memory
description: Use when the task involves repository-local memory, persistent user information, factual questions about what is recorded or available locally, bot capability questions grounded in this repository, or storing long-term preferences and notes.
---

# Memory

Use this skill for repository-local memory: retrieving recorded facts, storing long-term notes, and handling durable user preferences or other persistent context.

## Retrieval

- Prefer repository-local sources first for facts, memory, reminders, files, logs, and repository-grounded capability questions.
- For factual or capability questions, inspect local evidence before answering. This includes `README.md`, `memory/`, `assets/`, `system/`, relevant code, logs, and available skills.
- This applies to questions about who someone is, what is already recorded, what preferences or reminders exist, and what the bot can do according to local code and project state.
- If the answer may depend on wording, reminder, coordination, relay, or future behavior preferences, check `memory/preferences.md` early.
- Use web search only when local sources are insufficient.
- Treat frontmatter as lightweight support only. Keep it minimal and use it for `title`, `aliases`, `summary`, and sparse `tags`, not as the primary retrieval path.

## Note Routing

- All long-term markdown notes must live under `memory/`.
- Treat `system/` as code-managed persistent data rather than general-purpose notes. Do not move ordinary memory there or casually rewrite files there unless the task is explicitly about system-managed data.
- Merge related information into an existing topic note whenever it clearly fits. Keep each markdown file focused on one stable topic.
- Create a new note only when the information represents a distinct long-lived topic that does not fit an existing note.
- If new information conflicts with an existing note, update only when the intended replacement is clear; otherwise ask the user.

## Preference Storage

- If the user wants the bot to remember a standing preference, style, habit, or future behavior instruction, store it in `memory/preferences.md`.
- This includes how the bot should reply, what tone to use, how reminders should be phrased, who to coordinate with by default, and other standing "from now on" or "next time" guidance.
- Keep durable behavioral preferences in `memory/preferences.md` instead of scattering them across unrelated topic notes.

## Boundary With Reminders

- Do not turn every schedule mention, appointment, or birthday into a memory note.
- If the main task is interpreting, creating, changing, or reviewing reminders, use the `reminders` skill and let reminder storage own the schedule data.
- Only write to `memory/` when there is durable context worth remembering beyond the reminder itself.

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
