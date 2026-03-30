# Agent Instructions

This repository uses `memory-agent` as the primary workflow for retrieval, memory updates, and file organization.

- Default to checking repository memory first before answering requests that may relate to stored personal information, documents, photos, named entities, prior uploads, notes, or assets.
- Any repository-memory retrieval must go through the `memory-agent` skill rather than ad-hoc answering.
- Once triggered, follow `memory-agent` for detailed behavior.
