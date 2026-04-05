# Development Principles

For maintainers and implementation decisions, not as automatic runtime instructions for OpenCode.

## Core stance

- Learn from pi: keep the core minimal, composable, and easy to reshape.
- Adapt the system to the workflow, not the other way around.
- Trust the model's capability.
- Prefer complete, clean solutions over patches.
- Keep prompts concise and restrained.
- Prefer platform-agnostic prompts unless channel details are strictly required.
- Name required structured fields explicitly; otherwise do not over-constrain the model.

## Evolution

- Prefer cleaner design over preserving accidental structure.
- Do not optimize for backward compatibility by default.
- Avoid shims, dual-read logic, and legacy adapters unless migration requirements demand them.
- When architecture changes, update code and docs to the new source of truth.

## User-facing language

- Prefer model-generated wording over hard-coded conversational prose.
- Code should provide facts, state, and constraints; the model should phrase the reply.
- Keep persona consistent.
- All user-facing replies, including greetings, clarifications, confirmations, reminders, and follow-ups, must follow the configured persona.
- Reserve fixed copy for UI text, safety fallbacks, and deterministic labels.

## i18n

- Keep UI strings and deterministic schedule or unit text in i18n.
- Do not store conversational prose in i18n when the model can generate it.

## Structured context

- Keep canonical runtime truth in structured system-managed persistence.
- Use human-readable memory for long-term notes and lower-frequency reference material.
- Do not let human-readable notes become a competing source of truth.
- Prefer canonical ids, registries, and scoped applicability over prose summaries.
- Prefer narrow applicability and update existing rules instead of accumulating near-duplicates.
- Keep schemas general and flexible; avoid enum-heavy ontologies unless code truly needs them.
- Prefer atomic structured items: one item should describe one action, target, recipient, reminder, or mutation.
- Represent batch work as multiple atomic items rather than one item with embedded target arrays, unless grouped semantics are truly required by the domain.

## Architecture

- Keep the backbone small and understandable.
- Keep orchestration, domain logic, and persistence clearly separated.
- Keep orchestrators thin.
- Keep business logic in domain services.
- Keep platform-specific logic in adapters.
- Keep canonical truth in local state and persistence, not in prompts or session history.
- Avoid baking workflow-specific behavior into the core when a clearer module, extension point, or model judgment will do.

## Routing and model use

- Prefer structured state, skill catalogs, and model judgment over manual routing heuristics.
- Avoid brittle trigger phrases, substring guessing, and ad-hoc templates for core behavior.
- Deterministic retrieval infrastructure is fine when it supports lookup rather than replaces judgment.
- Use code for deterministic boundaries and persistence rules; use prompts for minimal task context.

## Memory organization

- Organize memory by topic.
- Keep notes concise, single-purpose, and easy to scan.
- Prefer one thing per file.
- Prefer bullet facts over long prose.
- Split large notes before they become catch-all dumps.
