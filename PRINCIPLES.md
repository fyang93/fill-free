# Internal development principles

These principles are for internal development work with pi and human maintainers. They are not intended to be an automatic runtime instruction layer for OpenCode.

## Core engineering stance

- Learn pi's philosophy.
- Trust the model's capability.
- Pursue excellence; reject half-finished solutions.
- Do not optimize for backward compatibility. Treat the project as an early-stage system that can still change freely when a cleaner design is better.
- Unless the user explicitly asks for migration compatibility, do not add fallback keys, compatibility shims, dual-read logic, legacy adapters, or silent data migration paths just to preserve old structure.
- When the architecture changes, update the code and docs to the new source of truth instead of carrying the old shape forward.
- Keep prompts concise and restrained.
- Prefer platform-agnostic prompts. Mention channel-specific details only when the task or output strictly depends on them.
- Do not add clever or defensive prompt text unless it is truly necessary.
- If the code strictly requires specific structured fields, name those critical fields explicitly in the prompt.
- If the code does not strictly require a detail, do not over-constrain the model.

## User-facing language

- Prefer model-generated user-facing wording over hard-coded reply text.
- Code should provide facts, state, and constraints; the model should phrase the final reply.
- Preserve persona consistency across normal replies, relays, reminder confirmations, and follow-up messages.
- Avoid fixed user-visible copy unless it is clearly UI text, a safety fallback, or a deterministic product label.

## i18n

- Be careful with internationalization.
- Keep UI strings, labels, buttons, and deterministic schedule/unit text in i18n.
- Avoid storing conversational reply prose in i18n when the model can generate it from facts.

## Memory vs system data

- Treat the model like a CPU, structured `system/*.json` data like memory, and `memory/*.md` notes like disk.
- Frequently injected operational context should live in structured `system/` data so code can pass it to the model quickly and deterministically.
- `memory/` is for human-readable long-term notes, background, and lower-frequency reference material.
- `system/` is for code-managed persistent data, canonical registries, runtime state, and structured context rules.
- Do not casually mix the two.

## Structured context and entity modeling

- Prefer canonical ids, registries, and scoped context rules over ad-hoc prose summaries.
- For platform identity, prefer stable platform-native ids as canonical keys across structured stores whenever possible.
- Platform usernames are useful mutable locators, not permanent identity keys; display names are presentation only.
- Map platform users and chats to canonical local records instead of storing human-written summaries in runtime state.
- Keep platform-specific identity handling in the platform adapter.
- Keep frequently used user/chat context in `system/users.json`, `system/chats.json`, and `system/rules.json`.
- Treat chats primarily as registries of participants and chat-level facts; do not assume every chat deserves a dedicated markdown memory file.
- Design structured JSON for generality: keep the envelope stable, but keep rule content flexible enough to support unknown future semantics.
- Prefer stable applicability metadata plus flexible rule content over rigid enumerations of rule categories.
- Do not overfit structured stores to today's small set of rule types unless code truly requires fixed fields.
- Avoid enum-heavy JSON design with ad-hoc `kind` / `type` / category fields when a stable pointer, scope, path, or generic target object is enough.
- Do not introduce new structured stores as disguised hard-coded ontologies; prefer generic references and minimal deterministic metadata over hand-maintained classification trees.
- Treat preferences as one kind of fast-injected rule content rather than assuming a separate rigid preference schema is always needed.
- `system/rules.json` is the canonical fast context layer for behavior guidance; `memory/preferences/` is optional human-readable documentation and should not drift into a competing source of truth.
- When storing a new durable behavior rule, choose the narrowest correct applicability first: single user/chat before some users/chats, some users/chats before all users/chats, and all users/chats before global.
- Prefer replacing or updating an existing rule with the same applicability and topic when the user is clearly revising it, rather than accumulating near-duplicate rules.

## Memory organization

- Organize `memory/` hierarchically by topic. Put same-kind notes into a folder, and group related folders under a higher-level folder when helpful.
- Keep each markdown note concise, single-purpose, and easy to scan.
- Prefer one thing per file whenever practical, especially for repeated item types like people, cards, accounts, records, and reusable context notes.
- Prefer bullet facts over long prose when possible.
- Aim for small files; when a note starts becoming long, split it before it becomes expensive for the model to process.
- Use aggregate notes as indexes or context summaries, not as ever-growing catch-all dumps.

## Architecture shape

- Prefer a backbone of `Application Runtime -> Role Pipeline -> Domain Services -> State/Persistence`.
- Treat AI Capability, Task Runtime, and Platform Adapter as side subsystems rather than main business layers.
- Keep platform-specific logic inside adapters.
- Keep role modules thin and orchestration-focused.
- Keep business logic in domain services.
- Keep canonical truth in local state and persistence, not in prompts or sessions.

## Runtime phase model

- Prefer a stable role-pipeline architecture: `responder`, `executor`, `responder-callback`, and `maintainer`.
- `responder` should prioritize fast user-facing understanding and produce the initial structured result.
- `executor` should perform the real actions and the smallest correct durable writes needed for the current task.
- `responder-callback` should turn execution facts into the final user-facing reply.
- `maintainer` should handle deeper cleanup, consolidation, consistency repair, and idle-time background upkeep.

## Keep the codebase clean

- Prefer small, well-named modules over growing a single controller or utility file into a catch-all.
- Avoid rebuilding manual routing or prompt-time heuristics when a skill catalog plus model judgment is sufficient.
- Do not gate core behavior on hand-maintained trigger phrase lists, ad-hoc sentence templates, substring guessing, or brittle keyword matching when structured state or model judgment should decide.
- Explicit retrieval structures such as the maintained inverted index are acceptable deterministic infrastructure, not prohibited heuristics.
- Use code for deterministic boundaries and persistence rules; use prompts for minimal task context, not duplicate enforcement.
