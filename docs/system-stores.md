# System stores

This document explains the role boundaries for JSON files under `system/`.

All files under `system/` are canonical runtime stores. Inspect them freely, but do not mutate them via generic write/edit/patch flows. Mutations should go through explicit repository CLI commands or the deterministic code paths that implement those CLI surfaces.

## Canonical stores

### `system/users.json`
Canonical user registry.

Stores:
- access level
- username / Telegram display name
- structured person-file association such as `personPath`
- user-scoped metadata such as last seen time

### `system/chats.json`
Canonical chat registry.

Stores:
- chat type/title
- chat participants
- chat-scoped last seen / updated timestamps

### `system/events.json`
Canonical event and automation store.

Stores:
- events
- embedded reminders for event notifications
- automation definitions
- delivery state for event occurrences

### `system/tasks.json`
Canonical durable task queue.

Stores:
- queued/running/blocked tasks
- async execution payloads
- task-level execution state

### `system/files.json`
Canonical Telegram file registry.

Stores:
- Telegram file unique ids
- saved file paths
- file metadata and last seen timestamps

### `system/state.json`
Canonical persisted runtime state.

Stores:
- selected model
- maintainer bookkeeping
- pending authorizations
- waiting-message candidate pool and per-candidate used flags

This file is for runtime state that affects behavior and must survive process restarts.

## Notes

- `system/state.json` is the active runtime state file.
- Legacy `system/runtime-state.json` may still be read as a migration fallback.
- Waiting-message candidates now live in canonical runtime state; do not reintroduce a separate `system/cache.json` for this pool.
- Do not normalize direct hand-edits to `system/` files as a maintenance workflow; if a mutation path is needed, expose it as an explicit CLI command first.
- Prefer adding a new store only when the data has a distinct ownership boundary.
