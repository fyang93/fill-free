---
name: memory
description: Use when the task involves repository-local memory, persistent user information, factual questions about what is recorded or available locally, bot capability questions grounded in this repository, or storing long-term preferences and notes.
---

# Memory

Use this skill for repository-local memory: retrieving recorded facts, storing long-term notes, and handling durable preferences or other persistent context.

## Retrieval

- Prefer repository-local sources first for recorded facts, memory, reminders, files, logs, and repository-grounded capability questions.
- Start with the smallest useful local evidence. Broaden inspection only when needed.
- If wording, habits, preferences, or long-term context may matter, check local memory notes early.
- Use web search only when local sources are insufficient.
- Treat frontmatter as lightweight support, not the primary retrieval path.

## Writing memory

- All long-term markdown notes belong under `memory/`.
- Merge into an existing note when the information clearly fits.
- Create a new note only when the information is a distinct long-lived topic.
- Keep each file focused on one stable topic or entity whenever practical.
- Prefer small, easy-to-scan notes.
- Prefer bullet facts over long prose.
- Avoid catch-all dumps and unnecessary duplication.
- If new information conflicts with an existing note, update only when the intended replacement is clear; otherwise ask.

## Preferences

- If the user wants a standing preference, style, habit, or future behavior instruction remembered, store it as durable reusable guidance.
- Keep related preferences grouped together instead of scattering them across unrelated notes.
- Choose the narrowest correct scope for standing guidance.
- If the user is revising an existing standing rule, update or replace it instead of accumulating near-duplicates.

## Boundary with reminders

- Do not turn every date, appointment, or birthday into a memory note.
- If the main task is interpreting, creating, changing, or reviewing reminders, use the `reminders` skill.
- Write to `memory/` only when there is durable context worth remembering beyond the reminder itself.

## Files

- If a file from `tmp/` should be kept long-term, persist the real file under `assets/` with a clear name in a sensible subdirectory.
- Link the real asset path from the relevant markdown.
- After successful persistence, clean up the old `tmp/` file unless the user clearly asked to keep it.

## Sensitive data

- Persisted data may enter AI context.
- Passwords may be persisted only when the user clearly and explicitly asks.
- Never persist API keys, private keys, recovery codes, seed phrases, session tokens, 2FA backup codes, or CVV.
- For other highly sensitive values, warn briefly and ask for confirmation before storing unless the user already clearly asked to persist them.
- If the user insists on storing a sensitive value that is not in the never-store list, do the minimum necessary and avoid repeating the raw value unless required.

## Validation

- Do not claim something was saved, moved, merged, linked, or persisted unless the repository was actually updated.
- After changes, quickly verify that referenced files exist and links point to the real asset path.
