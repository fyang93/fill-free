---
name: memory
description: Use when the task involves repository-local memory, persistent user information, factual questions about what is recorded or available locally, bot capability questions grounded in this repository, or storing long-term preferences and notes.
---

# Memory

Use this skill for repository-local memory: recorded facts, durable preferences, and long-term notes.

## Retrieval

- Prefer local sources first.
- In this multi-user bot, identify the relevant owner first. If a user is known in `system/users.json` with a `personPath`, use that as the primary entry point for user-specific memory.
- Start memory retrieval with keyword search over relevant markdown notes using the exact wording plus likely aliases or related terms.
- For stored files, use markdown entry points and linked paths before guessing file locations.
- Read the most relevant hits before answering.
- Do not say nothing is recorded until you have done a reasonable local search.
- Use web search only when local sources are insufficient.

## Writing

- Store long-term markdown notes under `memory/`.
- In this multi-user bot, store user-specific memory under the correct owner path rather than at top-level `memory/`.
- If the current requester or target user has a linked `personPath`, treat that as the default owner unless the request clearly refers to someone else.
- If no `personPath` is linked yet, a small provisional person note is acceptable.
- Merge into an existing note when it clearly fits; otherwise create a focused new note.
- Keep notes short, single-purpose, and easy to scan.
- Prefer bullet facts over long prose.
- Frontmatter is optional; do not invent rigid schemas.
- If new information conflicts with an existing note and replacement is unclear, ask.

## Organization

- Prefer one stable taxonomy over ad-hoc top-level files.
- Organize memory by scope first, then by topic.
- Use `memory/people/` for one-person material, `memory/shared/` for shared owner material, and `memory/common/` for repository-wide reference material.
- Prefer directory-style person storage with a canonical entry at `memory/people/<slug>/README.md` and supporting notes nearby.
- Keep top-level `memory/` for rare navigation indexes only.
- When reorganizing existing notes, update links and remove obsolete duplicates.

## Boundaries

- Use `cli-rules` for deterministic standing assistant rules.
- Use `cli-schedules` when the main task is schedule state.
- Do not turn every appointment or date into memory.

## Files

- Prefer the simplest owner-local file layout that keeps related material together.
- If a `tmp/` file should be kept, persist it directly under the relevant owner-scoped `memory/` directory.
- Keep person-owned files under that person's directory and shared-owner files under the shared owner path.
- Add or update a small markdown entry point when it helps retrieval.
- Link kept files from the relevant markdown entry point.
- After persistence, remove the old `tmp/` file unless the user asked to keep it.

## Sensitive data

- Persisted data may enter AI context.
- Never store API keys, private keys, recovery codes, seed phrases, session tokens, 2FA backup codes, or CVV.
- Store passwords only if the user explicitly asks.
- For other sensitive values, warn briefly and confirm unless the user already clearly asked to store them.

## Validation

- Do not claim something was saved, moved, merged, linked, or persisted unless the repository was actually updated.
- When ownership becomes clearer later, prefer cleanup that consolidates provisional notes into the canonical owner path.
