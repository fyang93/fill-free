# Architecture Notes

Current architectural direction. Like pi itself, this architecture should stay minimal, composable, and easy to reshape. It should adapt to the workflow instead of forcing the workflow to adapt to it.

## Shape

Preferred backbone:

`Application Runtime -> Conversation Agent -> Repository CLI + Skills -> Domain Services -> State/Persistence`

Code layout should mirror this separation: bot-side orchestration, platform adapters, domain logic, and runtime support under `src/bot/**`, and repo-CLI entrypoints and command handlers under `src/cli/**`.

This backbone should stay small and understandable. AI wrappers, task helpers, platform adapters, and repository-specific helpers should support it, not become the main home of business logic.

## Boundaries

- Runtime coordinates phases, orchestrates current-turn reply publication, and owns interruption / cancellation / duplicate-publication guards.
- Shared deterministic delivery code should remain the single Telegram send path for files/messages; runtime ownership of current-turn publication is about timing and guards, not a second bot-only transport implementation.
- Role outputs should stay close to user/task intent, not final persistence-heavy schemas.
- Repository-local CLI and skills are the default execution surface for repository work.
- Skills provide reusable cognitive scaffolding: where to look, how to research, how to follow repository conventions, and how to structure recurring multi-step work.
- Domain services own business rules.
- Platform adapters translate external platform details into local canonical records.
- Persistence owns durable state and structured context.
- Prompts, sessions, skills, and CLI transcripts are delivery and execution aids, not the source of truth.

## Runtime phases

Preferred runtime shape:

- `assistant`
- `runtime conversation controller`
- `maintainer`

This is the current preferred shape, not a permanent product doctrine. If a cleaner design emerges, change the architecture instead of preserving accidental structure.

The current preference is therefore a single assistant that mainly works through repository-local CLI entrypoints and a small skill set (`cli-shared`, `cli-schedules`, `cli-telegram`, `cli-access`, and `memory`), while the runtime retains reply publication, waiting-state behavior, and safety responsibilities. The code should also keep the bot surface and the repo-CLI surface physically separate so their responsibilities stay explicit (`src/bot/**` vs `src/cli/**`).

### `assistant`
- Interprets the request and performs needed work through repository-local CLI commands.
- Uses skills when a task benefits from reusable repository-specific guidance or research workflow.
- Returns final user-visible text for the runtime to publish.
- Should not rely on brittle answer-mode text protocols or hidden handoff conventions.
- Must not emit protocol text, internal narration, or CLI / platform / prompt / filesystem meta explanation in user-facing output.

### `runtime conversation controller`
- Starts, interrupts, merges, and cancels turns.
- Owns waiting-state UI, message lifecycle safeguards, and current-turn reply publication orchestration.
- Reuses shared deterministic delivery paths for actual Telegram sends instead of maintaining a separate bot-only transport path.
- Uses actual runtime outcomes and canonical persistence as the truth source for what happened.
- Stays thin: it coordinates runtime boundaries, not domain facts.

### `maintainer`
- Handles cleanup, consolidation, repair, and background upkeep.
- Uses the same CLI + skill philosophy.

## State and memory

- Structured system-managed data holds canonical runtime state and fast operational context.
- Human-readable memory holds durable notes and lower-frequency reference material.
- Each fact should have a clear canonical owner.
- Keep canonical truth in state and persistence, not in prompts, sessions, skill prose, or ad-hoc notes.
- Canonical stores such as schedules, users, tasks, chats, runtime state, and file registries should be written through deterministic code paths even when the triggering request was model-interpreted.
- User preferences and behavioral guidance should live in markdown memory and be injected as context rather than maintained in a separate structured rules store.
- Prefer intent-to-state compilation over having the model directly author large final JSON or YAML persistence shapes.

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
- Prefer skills and CLI contracts over new assistant-side execution abstractions.

## Documenting concrete storage

Document filenames, directories, and schemas only when code, maintainer workflow, or external tooling depends on them. Otherwise, document the invariant and keep the storage layout flexible.

## Concrete current preference

- Repository-local CLI commands should be the primary execution surface.
- The current preferred entrypoint is `npm run repo:cli -- <command> '<json>'` (direct file form: `tsx --tsconfig tsconfig.json src/cli.ts <command> '<json>'`).
- Skills should capture durable repository know-how and recurring research / maintenance workflows.
- The current preferred skill map is: `cli-shared` for shared CLI guidance, `cli-schedules` for schedule workflows, `cli-telegram` for outbound Telegram delivery, `cli-access` for users and authorization, and `memory` for durable repository-local notes.
- Current-turn reply publication orchestration should stay in runtime code.
- Actual Telegram delivery should still flow through shared deterministic delivery code / CLI-backed paths so current-chat sends and outbound sends do not drift into separate implementations.
- Repository-specific operations should use CLI + skills.
- Internal registries, task queues, chat synchronization, and maintenance state should stay in code rather than the assistant surface.
- Markdown memory updates should follow the same repository-side execution boundaries instead of adding a parallel assistant-side abstraction.
- User-visible wording should still carry the configured persona style.
- The assistant should reply in the user's natural conversation language; fixed UI text should follow the user's selected UI locale.
- Time context injected into prompts should be converted into the requester's timezone before being shown to the model.
