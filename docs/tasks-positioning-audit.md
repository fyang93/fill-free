# tasks.json Positioning Audit

This document is kept only as a historical note.

## Status

The project no longer uses `tasks.json`.

What replaced it:
- reminder delivery text is prepared directly in normal event create/update/startup flows
- delayed outbound Telegram delivery is delegated to external schedulers via the CLI

## Result

There is no longer an internal durable task queue in the repository runtime architecture.
