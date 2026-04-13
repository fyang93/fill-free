---
name: memory
description: Use when the task involves repository-local memory, persistent user information, factual questions about what is recorded or available locally, bot capability questions grounded in this repository, or storing long-term preferences and notes.
---

# Memory

Use this skill for repository-local memory: retrieving recorded facts, storing long-term notes, and handling durable preferences or other persistent context.

## Retrieval

- Prefer repository-local sources first for recorded facts, memory, schedules, files, logs, and repository-grounded capability questions.
- Start with the smallest useful local evidence. Broaden inspection only when needed.
- For factual lookup in `memory/`, begin with keyword search using `rg -n --no-ignore` over `memory/` before concluding nothing is recorded.
- Search for the user's exact wording, likely aliases, usernames, transliterations, related names, and key relationship words when relevant.
- Check both frontmatter and body text, including links and nearby context, but treat frontmatter as lightweight support rather than the only source.
- After `rg` finds candidate files, read the most relevant hits and answer from those files instead of guessing.
- If wording, habits, preferences, or long-term context may matter, check local memory notes early.
- Use web search only when local sources are insufficient.

### Retrieval pattern

- Prefer `rg -n --no-ignore` for first-pass keyword lookup, for example searching `memory/` for the exact term and likely aliases.
- When you need to enumerate candidate files or inspect note layout before reading, prefer `fd --no-ignore`.
- If the first search misses, broaden with alternate spellings, nicknames, usernames, and relationship terms.
- Do not say memory has no record until you have tried a reasonable keyword search over `memory/`.

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

## Boundary with schedules

- Do not turn every date, appointment, or birthday into a memory note.
- If the main task is interpreting, creating, changing, or reviewing schedules, use the `cli-schedules` skill.
- Write to `memory/` only when there is durable context worth remembering beyond the schedule itself.

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
