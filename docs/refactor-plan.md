# Refactor Plan: Toward a Small, Clear, Local-First Bot

This plan tracks the current repository-wide simplification pass.

Primary goal:

- keep the existing feature set and core behavior
- reduce code volume, policy duplication, and concept count
- make the project easier to understand, reshape, and maintain
- stay aligned with `docs/principles.md`

Non-goals:

- adding major new capabilities
- introducing new architectural layers
- preserving accidental structure just because it already exists

## Simplification goals

- Fewer concept layers between user request and canonical state mutation.
- Fewer repeated policy statements across prompts, gateway code, skills, and docs.
- Smaller and more semantic skill set.
- Clearer ownership boundaries:
  - model interprets natural language and intent
  - code validates, normalizes, persists, and projects deterministic facts
  - runtime owns current-turn publication orchestration
- Shorter data flows for schedules, rules, context, and reply composition.
- Less code that exists only to compensate for older prompt or routing structure.

## Working rules for this refactor

1. Prefer deletion over relocation when code is redundant.
2. Prefer merging thin wrappers into a clearer owner instead of adding another helper.
3. Keep prompts minimal; do not restate code-enforced behavior unless the model truly needs it for judgment.
4. Keep skills as semantic workflow scaffolding, not routing encyclopedias.
5. Preserve deterministic truth boundaries.
6. Preserve externally visible behavior unless the simplification itself intentionally corrects a design inconsistency.

## Todo list

### Phase 0: docs and refactor guardrails

- [x] Align `docs/principles.md` with the simplification pass and current rule/memory boundaries.
- [x] Align `docs/architecture.md` with the simplification pass and current semantic skill map.
- [x] Keep this plan updated as work progresses; check items as they are completed.

### Phase 1: prompt, gateway, and context slimming

- [x] Audit duplicated policy across `src/bot/ai/prompt.ts`, `src/bot/ai/gateway.ts`, context builders, and skills.
- [x] Remove prompt instructions that merely restate deterministic runtime or CLI guarantees.
- [x] Reduce repeated memory/rules/schedule guidance to the minimum needed for model judgment.
- [x] Simplify assistant context payloads so they carry facts, not duplicated policy prose.

### Phase 2: skill and doc boundary cleanup

- [x] Review all skills for scope creep, repeated routing advice, and duplicated architecture text.
- [x] Keep only the minimum cross-skill boundary reminders needed for semantic clarity.
- [x] Remove stale skill assumptions and old workflow language from docs and prompts.

### Phase 3: schedule path compression

- [x] Trace the full schedule flow from prompt interpretation to CLI mutation to delivery text and identify redundant transforms.
- [x] Simplify schedule serialization and display/projection helpers where ownership is currently split too finely.
- [x] Reduce duplicated time and timezone explanation across code, prompts, and skills while preserving the model/code boundary.
- [x] Ensure code handles deterministic timezone normalization/projection while the model remains responsible for natural-language time semantics.

### Phase 4: rules and memory boundary cleanup

- [x] Reconfirm and document the canonical split between `cli-rules` and `memory`.
- [x] Remove mixed messaging where prompts or docs imply both paths own the same kind of long-term guidance.
- [x] Simplify any retrieval/update flow that still treats human-readable memory and structured rules as overlapping truth owners.

### Phase 5: code-volume reduction and dead-structure removal

- [x] Identify thin wrappers, one-off indirection layers, and legacy leftovers that can be deleted or merged.
- [x] Remove obsolete files, comments, and compatibility logic that no longer match the preferred architecture.
- [x] Consolidate small scattered helpers when they do not earn their file/module boundary.
- [x] Re-run typecheck and targeted behavior checks after each reduction batch.

### Phase 6: final pass

- [x] Review the repository for remaining policy duplication after structural cleanup.
- [x] Re-read `docs/principles.md` and verify the resulting code still follows the intended truth boundaries and simplification goals.
- [x] Write a short final summary in this file describing what was simplified and what was intentionally left alone.

## Final summary

Completed simplifications in this pass:

- added a dedicated refactor plan and aligned the main docs with the simplification direction
- reduced duplicated assistant policy across `prompt.ts`, `gateway.ts`, and assistant context construction
- made assistant context more factual by dropping empty rule scaffolding and trimming turn-time payload shape
- kept the semantic skill map small and removed the old shared-skill layer
- clarified the split between `cli-rules` and `memory`
- moved repeated timezone formatting into shared time utilities and simplified schedule CLI serialization
- removed dead legacy rule-store code and an unused rules task handler

Intentionally left alone in this pass:

- the model still owns natural-language schedule interpretation such as deciding between local and absolute semantics
- the runtime / CLI / persistence truth boundaries remain unchanged
- the current semantic skill set remains in place because it is already small and understandable

## Expected outcomes

If this refactor succeeds, the project should feel smaller in the following concrete ways:

- fewer files participate in core policy definition
- fewer assistant-facing abstractions are needed to complete ordinary work
- schedule and rules flows are easier to trace end-to-end
- it is easier to tell whether a bug belongs to model interpretation, deterministic code, runtime orchestration, or persistence
- a new maintainer can understand the main execution surface quickly
