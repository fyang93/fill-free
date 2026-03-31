---
name: memory-agent
description: Use for lightweight memory retrieval, note updates, and organizing long-term files in this repository.
---

# Memory Agent

Use this skill when the user asks to remember, save, update, organize, merge, link, or retrieve long-term information from this repository.

## Retrieval

- Prefer `fd` and `rg` for retrieval. Start with the smallest useful `rg` result and only read full files when needed.
- Treat frontmatter as lightweight support only. Keep it minimal and use it for `title`, `aliases`, `summary`, and sparse `tags`, not as the primary retrieval path.

## Note Routing

- Merge related information into an existing topic note whenever it clearly fits. Keep each markdown file focused on one stable topic.
- Use existing topic notes when possible: identity/documents -> `profile.md`, banking/financial details -> `banking.md`, people/contact details -> `contacts.md`, family relationships -> `family.md`, pets -> `pets.md`.
- Create a new note only when the information represents a distinct long-lived topic that does not fit an existing note.
- If new information conflicts with an existing note, update only when the intended replacement is clear; otherwise ask the user.

## Files

- If a file from `tmp/` should be kept long-term, persist the real file under `assets/` first, organize it into a sensible subdirectory, and give it a clear filename.
- Link the real asset path from the relevant markdown. Do not use markdown placeholder files under `assets/` instead of the real uploaded file.
- After successful persistence, clean up the old `tmp/` file unless the user clearly asked to keep it.

## Sensitive Data

- There is no separate local-secret workflow in this repository; persisted data may enter AI context.
- Never persist passwords, API keys, private keys, recovery codes, seed phrases, session tokens, 2FA backup codes, or CVV.
- For other highly sensitive values such as ID numbers, passport numbers, residence card numbers, bank card numbers, full addresses, or phone numbers, warn briefly first and ask for confirmation before storing unless the user has already clearly and explicitly asked to persist them.
- If the user insists on storing sensitive values that are not in the never-store list, do the minimum necessary and avoid repeating the raw value unless required.

## Validation

- Do not claim something was saved, moved, merged, linked, or persisted unless the repository was actually updated.
- After making changes, quickly verify that referenced files exist and markdown links point to the real asset path.
