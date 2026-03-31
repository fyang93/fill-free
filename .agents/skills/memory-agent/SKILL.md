---
name: memory-agent
description: Use in this repository for durable memory retrieval and updates, organizing files from `tmp/` into long-term storage, and handling explicit requests to remember, save, store, or update information for later reuse. Do not treat ordinary chat as memory.
---

# Memory Agent

## Purpose

Use this skill for durable memory retrieval, updates, and file organization in this repository.

Repository roles:

- `memory/`: long-term AI-safe markdown notes
- `index/`: generated retrieval indexes
- `assets/`: organized long-term files
- `tmp/`: temporary user files and AI outputs

Use the CLI instead of ad-hoc scanning so retrieval stays cheap and predictable.

## Command Source Of Truth

- Use the repository's `just` CLI.
- For live commands and examples, run `just --list --unsorted`.
- Treat this skill as workflow policy; prefer base commands with flags over wrapper recipes.

## Retrieval Workflow

Search from cheapest to most expensive:

1. `just find --top 3 --paths QUERY`
2. `just find --top 3 QUERY`
3. `just find QUERY`
4. `just list --paths 10` or `just list --paths 100`
5. `just list` or `just list 10` / `just list 100`
6. `just frontmatter NOTE`
7. `just body NOTE`
8. `just search --files PATTERN`
9. `just search --context 2 --max-count 1 PATTERN`
10. `just search PATTERN`

Rules:

- Default to `just find --top 3 --paths QUERY` when a few likely candidates are enough.
- `just find` searches indexed path, title, tags, aliases, and `summary`, not note bodies.
- A miss from `just find` is not proof that no note exists; use `just search` when body text may matter.

## What To Capture

- Record durable user facts and explicit requests to remember, save, store, or update information.
- Treat reusable form fields and supporting document organization as first-class memory.
- Do not treat ordinary conversation as memory.
- Do not store preferences, habits, moods, or speculation unless the user explicitly asks.

## Sensitive Data

There is no separate local-secret workflow in this repository.

- Handle ordinary personal profile fields directly when asked.
- For highly sensitive values such as passwords, API keys, private keys, recovery codes, credit card numbers, or CVV, warn that the value may enter AI context and there is no local-only secret path here.
- If the user does not insist, do not store it.
- If the user explicitly insists, do the minimum necessary and avoid repeating the raw value unless required.

## Note Format

- Every note starts with `---` frontmatter.
- Allowed frontmatter fields: `title`, `date`, `tags`, `aliases`, `summary`.
- Use lowercase English field names.
- `date` is required and must be `YYYY-MM-DD`.
- Keep `title`, `date`, `summary`, `tags`, and `aliases` simple and single-line; use array literals such as `tags: ["profile", "education"]`.
- Keep tags sparse: at most 3, in English `kebab-case`.
- Leave one blank line between frontmatter and body.
- Keep YAML simple; avoid multiline or nested structures.
- Use `summary` as the main retrieval hint.
- Prefer one topic-focused note per durable subject instead of catch-all notes.
- Split notes when they start covering multiple stable retrieval domains.
- Prefer English filenames such as `memory/profile.md` or `memory/banking.md`.
- Use Chinese for note title and body by default unless another language is clearly better.
- Keep committed markdown AI-safe.

## Writing And Updating

1. Search for the best existing note first.
2. Update an existing note when its title, aliases, tags, or topic clearly match.
3. If multiple notes fit, prefer the one whose title or aliases most directly name the subject.
4. If none fit, create a new topic-focused note under `memory/`.
5. If new information belongs to a different durable topic, create a sibling note instead of broadening the current one.
6. If information is clear, update directly. If it is ambiguous or inferred, ask briefly first.

## Index, Validation, And Usage Tracking

- Run `just index` after creating, renaming, moving, or deleting notes in `memory/`, or after changing indexed frontmatter such as `title`, `tags`, `aliases`, or `summary`.
- Body-only edits usually do not need manual indexing.
- Run `just use NOTE` only when a note was actually used in a real downstream task, not for ordinary lookup.
- Run `just check` before claiming repository state is valid.
- Treat `just check` topic-sprawl output as advisory, not as a hard failure.

## Files And Safety

- Never delete files under `assets/` or `memory/` unless the user explicitly requests deletion.
- If deletion seems necessary, ask for confirmation first.

For files in `tmp/`:

- Treat `tmp/` as temporary storage for user materials and AI outputs.
- Unless the user explicitly asks otherwise, do not inspect contents; organize by filename and user instructions only.
- When organizing into long-term storage, move files into sensible English subpaths under `assets/`, such as `assets/imgs/` or `assets/docs/`.
- Copy instead of move only if the user explicitly asks to keep the original in `tmp/`.
- Add markdown links from the relevant note when needed.
- Put temporary drafts and working outputs back into `tmp/` unless the user asks for long-term storage.

For PDF, spreadsheet, or other document-filling skills:

- Use this repository for memory organization and file linking; let the external skill handle parsing and file writing, and ask only when required information is missing.
