# System stores

This document explains the role boundaries for JSON files under `system/`.

## Canonical stores

### `system/users.json`
Canonical user registry.

Stores:
- access level
- username / display name
- user-scoped metadata such as last seen time

### `system/chats.json`
Canonical chat registry.

Stores:
- chat type/title
- chat participants
- chat-scoped last seen / updated timestamps

### `system/schedules.json`
Canonical schedule and scheduled-task store.

Stores:
- reminders
- recurring schedules
- scheduled-task definitions
- delivery state for schedule occurrences

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
- Prefer adding a new store only when the data has a distinct ownership boundary.
