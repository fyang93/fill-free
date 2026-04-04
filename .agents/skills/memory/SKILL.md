---
name: memory
description: Use when the task involves repository-local memory, persistent user information, factual questions about what is recorded or available locally, bot capability questions grounded in this repository, or storing long-term preferences and notes.
---

# Memory

Use this skill for repository-local memory: retrieving recorded facts, storing long-term notes, and handling durable user preferences or other persistent context.

## Retrieval

- Prefer repository-local sources first for facts, memory, reminders, files, logs, and repository-grounded capability questions.
- Treat the model like a CPU, structured `system/*.json` data like memory, and `memory/*.md` notes like disk.
- For high-frequency operational context, inspect structured `system/` sources first so code can inject relevant facts quickly and deterministically.
- For factual or capability questions, start with fast structured and indexed local evidence. Use broader repository inspection only when local evidence is insufficient.
- This applies to questions about who someone is, what is already recorded, what preferences or reminders exist, and what the bot can do according to local code and project state.
- If the answer may depend on wording, reminder, coordination, relay, or future behavior preferences, check structured rules in `system/rules.json` early, then fall back to `memory/preferences/` notes when needed.
- Treat preferences as one category of reusable rule content, not as a guarantee that future behavior guidance will fit a tiny fixed preference schema.
- `system/rules.json` is canonical for fast behavior/context injection; `memory/preferences/` is documentation, explanation, and index material only.
- Prefer stable applicability metadata plus flexible rule content over rigid enumerations of rule categories.
- Use web search only when local sources are insufficient.
- Treat frontmatter as lightweight support only. Keep it minimal and use it for `title`, `aliases`, `summary`, and sparse `tags`, not as the primary retrieval path.

## Note Routing

- All long-term markdown notes must live under `memory/`.
- Treat `system/` as code-managed persistent data rather than general-purpose notes. Do not move ordinary memory there or casually rewrite files there unless the task is explicitly about system-managed data.
- Merge related information into an existing topic note whenever it clearly fits. Keep each markdown file focused on one stable topic.
- Create a new note only when the information represents a distinct long-lived topic that does not fit an existing note.
- If new information conflicts with an existing note, update only when the intended replacement is clear; otherwise ask the user.
- Organize notes hierarchically by topic directory when that makes retrieval cleaner, especially `memory/people/`, `memory/contexts/`, `memory/preferences/`, `memory/records/`, and similar subtrees.
- Prefer one thing per file whenever practical. Repeated item types such as people, cards, accounts, records, and reusable context notes should usually each get their own small markdown file.
- For person-specific information, prefer one dedicated file per person under `memory/people/` rather than burying multiple people inside a shared catch-all note.
- When a shared note must mention multiple things, keep it as an index, relationship note, or context note and link to the dedicated child files.
- Person files may link to each other when relationships matter, but avoid duplicating the same facts across many files.
- Keep markdown concise. Prefer short bullet facts over long prose, and split notes before they grow large enough to slow down retrieval.
- When a system-managed record needs to point at a Telegram-linked user or reusable behavior rule, update canonical structured data in `system/users.json`, `system/chats.json`, or `system/rules.json` instead of storing a prose summary in runtime state.
- Keep structured JSON generic where possible: use a stable rule envelope and flexible payloads so unknown future rule types still fit cleanly.
- Avoid enum-heavy JSON with ad-hoc `kind` / `type` / category fields unless code truly requires them; prefer generic references, paths, and minimal deterministic metadata.

## Preference Storage

- If the user wants the bot to remember a standing preference, style, habit, or future behavior instruction, update canonical structured rules in `system/rules.json` first.
- Use `memory/preferences/` for concise human-readable preference notes and indexes only when documentation is helpful.
- This includes how the bot should reply, what tone to use, how reminders should be phrased, who to coordinate with by default, and other standing "from now on" or "next time" guidance.
- Keep durable behavioral preferences grouped under `memory/preferences/` instead of scattering them across unrelated topic notes, but do not let those notes become a competing source of truth.
- Do not force every preference into a fixed field like `birthdayOffsets` or `meetingOffsets` unless code truly depends on that exact structure; prefer generic scoped rules that still read cleanly to the model.
- Choose the narrowest correct applicability when writing a rule: one user/chat before some users/chats, some before all, and all before global.
- If the user is clearly revising an existing standing rule, update or replace the old rule instead of accumulating near-duplicates.
- Use `memory/preferences/` notes to explain or summarize a rule only when a human-readable note is genuinely useful; do not mirror every structured rule into markdown by default.

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
