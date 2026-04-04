# Architecture Notes

Current architectural direction. Like pi itself, this architecture should stay minimal, composable, and easy to reshape. It should adapt to the workflow instead of forcing the workflow to adapt to it.

## Shape

Preferred backbone:

`Application Runtime -> Role Pipeline -> Domain Services -> State/Persistence`

This backbone should stay small and understandable. AI wrappers, task helpers, and platform adapters should extend it and support it, not become the main home of business logic.

## Boundaries

- Runtime coordinates phases and moves structured results.
- Domain services own business rules.
- Platform adapters translate external platform details into local canonical records.
- Persistence owns durable state and structured context.
- Prompts and sessions are delivery mechanisms, not the source of truth.

## Runtime phases

Preferred pipeline:

- `responder`
- `executor`
- `responder-callback`
- `maintainer`

This is the current preferred shape, not a permanent product doctrine. If a cleaner design emerges, change the architecture instead of preserving accidental structure.

### `responder`
- Interprets the request quickly.
- Produces the initial structured result.
- Decides what needs execution.

### `executor`
- Performs actions.
- Writes the smallest correct durable state.
- Returns execution facts.

### `responder-callback`
- Turns execution facts into the final reply.
- Preserves persona and continuity.

### `maintainer`
- Handles cleanup, consolidation, repair, and background upkeep.

## State and memory

- Structured system-managed data holds canonical runtime state and fast operational context.
- Human-readable memory holds durable notes and lower-frequency reference material.
- Each fact should have a clear canonical owner.
- Keep canonical truth in state and persistence, not in prompts, sessions, or ad-hoc prose.

## Identity and context

- Prefer stable canonical identifiers.
- Treat usernames and similar handles as mutable locators, not durable identity.
- Store applicability explicitly when behavior or context is scoped.
- Keep platform-specific identity translation inside adapters.

## Extensibility

Following pi's philosophy, avoid baking every workflow choice into the core architecture.

- Prefer a small backbone with clear extension points over a large all-knowing core.
- Add specialized behavior in the right module or subsystem instead of turning central orchestrators into catch-alls.
- Prefer explicit structure and model judgment over hand-built routing layers and workflow-specific hacks.

## Documenting concrete storage

Document filenames, directories, and schemas only when code, maintainer workflow, or external tooling depends on them. Otherwise, document the invariant and keep the storage layout flexible.
