# Development Principles

CRITICAL: Whenever you find code that violates the current principles, adjust it accordingly.

This project now prefers a **CLI + skills** execution model.
The goal is to stay close to pi-mono's philosophy: a small backbone, composable workflows, and minimal project-specific abstractions.

This document is ordered by decision strength:
- **Hard constraints**: should normally be treated as mandatory system invariants.
- **Strong defaults**: follow by default; deviate only with a clear reason.
- **Tradeoffs and preferences**: useful heuristics, but not rules to apply mechanically.

## Hard constraints

### Truth boundaries

- Keep canonical runtime truth in structured system-managed persistence.
- Keep canonical truth in local state and persistence, not in prompts, session history, CLI transcripts, or human-readable notes.
- Keep canonical truth in structured stores such as schedules, users, tasks, chats, and registries when runtime behavior depends on it.
- Treat successful runtime state mutation and deterministic code paths as the truth source for whether an action happened.
- Do not duplicate that truth in prompt rules, session prose, or post-hoc text interpretation when code can decide it directly.
- Do not let execution mutate canonical state before the runtime has a clear ownership boundary for the current turn's visible reply publication.

### Runtime-owned boundaries

- The runtime owns current-turn reply publication orchestration, waiting-state UI, interruption, cancellation, and duplicate-publication guards.
- Publication orchestration ownership does not justify a separate bot-only Telegram transport path. Message/file delivery should use one shared deterministic delivery implementation exposed through the repository CLI surface and reused by runtime code when needed.
- Permissions, argument validation, logging, and result checks must be enforced in code, not delegated to prompt instructions or skills.
- Repository CLI commands must return an explicit machine-readable success signal. Successful outcomes should set `ok: true`; rejected, skipped, ambiguous, unresolved, or failed outcomes should set `ok: false` with a stable error/reason so the model and runtime do not mistake non-effects for success.
- CLI mutation commands that change canonical state must use controlled deterministic mutation surfaces. Support explicit single-target mutation and explicit batch mutation, but do not let broad implicit matches silently mutate multiple canonical records.
- Prefer one monotonic permission lattice in code (for example `none < allowed < trusted < admin`) and compare against the minimum required level instead of scattering role-pair special cases across the codebase.
- Use runtime guards and tests to protect truth boundaries.
- Human-readable memory must not become a competing source of truth.

### Current-turn responsiveness

- When work may take noticeable time, the runtime should publish a brief acknowledgment as early as practical.
- Minimize time-to-first-reply (TTFR). A fast brief acknowledgment is better than a delayed comprehensive response.
- Prefer explicit progress boundaries over subjective "long enough" heuristics: if the assistant is about to perform tool-based or multi-step work and the final user-visible answer will not be immediate, it should emit a short current-turn progress update early.
- Keep progress signaling narrow, current-turn-scoped, and low-chatter.

### Canonical structured context vs human-readable memory

- Use markdown memory for durable notes, reference material, and user preferences.
- Store user preferences and behavioral guidance in markdown memory rather than a separate structured rules store.
- Keep canonical operational state in structured persistence, and keep human-readable memory as reference context rather than operational truth.

### User-visible output boundaries

- Prefer model-generated wording over hard-coded conversational prose.
- Code should provide facts, state, and constraints; the model should phrase the reply.
- All user-facing replies must follow the configured persona.
- Inject persona at message generation time for every user-visible bot-authored path, including assistant replies, greeter output, and maintainer summaries.
- Do not implement persona as a second-stage rewrite, polishing pass, or post-processing layer over already-generated user text.
- Deterministic UI labels/buttons may remain in i18n, but they should still be authored to stay consistent with the configured persona where applicable.
- Persona belongs only in final user-visible text, not in hidden reasoning or internal planning.
- User-visible replies should describe confirmed user-relevant outcomes, not internal execution mechanics.
- Do not expose internal commands, shell snippets, CLI entrypoints, file paths, prompt rules, or implementation steps unless the user explicitly asks for technical detail.
- Fix user-visible leakage at the prompt, architecture, or reply-boundary level; do not rely on content-specific string blacklists as the primary solution.
- Do not add or keep content-specific reply policing heuristics that try to infer correctness from particular words or phrases in free-form model text.
- Reserve fixed copy for UI text, safety fallbacks, and deterministic labels.
- Keep UI strings and deterministic schedule or unit text in i18n.

## Strong defaults

### Core stance

- Learn from pi: keep the core minimal, composable, and easy to reshape.
- Adapt the system to the workflow, not the other way around.
- Trust the model's capability.
- Prefer complete, clean solutions over patches.
- Prefer repository-local CLI entrypoints and small scripts for deterministic execution.
- Use skills as cognitive scaffolding: documentation maps, repository conventions, research patterns, and recurring multi-step guidance.
- Name required structured fields explicitly; otherwise do not over-constrain the model.
- Prefer platform-agnostic prompts unless channel details are strictly required.

### Architecture and execution model

- Keep the backbone small and understandable.
- Keep orchestration, domain logic, and persistence clearly separated.
- Keep orchestrators thin.
- Keep business logic in domain services.
- Keep platform-specific logic in adapters.
- Prefer a CLI + skills execution surface.
- Keep the bot-side code and the repo-CLI code in separate modules/directories so execution boundaries stay obvious in code as well as in prompts.
- Prefer repository-local CLI commands for general repository work.
- Use skills to teach stable repository workflows.
- Avoid baking workflow-specific behavior into the core when a clearer module, extension point, CLI contract, or model judgment will do.

### Structured context and persistence shape

- Prefer canonical ids, registries, and scoped applicability over prose summaries.
- Prefer narrow applicability and update existing rules instead of accumulating near-duplicates.
- Keep schemas general and flexible; avoid enum-heavy ontologies unless code truly needs them.
- Prefer atomic structured items: one item should describe one action, target, recipient, schedule, or mutation.
- Represent batch work as multiple atomic items rather than one item with embedded target arrays, unless grouped semantics are truly required by the domain.
- For schedules, one real-world event should map to one schedule event record; multiple schedule times for that event should be represented as multiple notification offsets on the same event, not as duplicate schedule events.
- Prefer model output at the intent layer over asking the model to emit final persistence-heavy schemas directly.
- Let code compile narrow model intents into canonical structured persistence when structured persistence is still required.
- Do not push large final JSON or YAML persistence shapes onto the model when a smaller intent contract plus deterministic code mapping will do.
- Use durable task queues only for work that truly must outlive the current turn or execute asynchronously.

### Routing and model use

- Prefer structured state, skill catalogs, and model judgment over manual routing heuristics.
- Avoid brittle trigger phrases, substring guessing, and ad-hoc templates for core behavior.
- Deterministic retrieval infrastructure is fine when it supports lookup rather than replaces judgment.
- Use code for deterministic boundaries and persistence rules; use prompts for minimal task context.
- Prefer the simplest lane structure that preserves clear truth boundaries.
- Prefer a single assistant lane unless a split materially improves latency or control without duplicating routing truth.
- Keep any fast-lane context narrowly scoped and latency-oriented.
- Prefer small Top-N relevant fact slices over broad context dumps.
- Do not keep prompt instructions that merely restate code behavior the runtime already enforces.
- Inject permission guidance into prompts only when the current access level materially changes model judgment for the turn; avoid blanket role prose on every prompt.
- Prefer narrow role-specific prompt constraints over broad permission dumps: e.g. allowed-user limits only for allowed users, admin-only management limits only for trusted users, and no extra permission prose for admin unless the turn truly needs it.
- Prefer repository-local file paths plus native file-reading tools over directly inlining or force-attaching raw files to the main assistant prompt by default. This keeps the assistant lane model-agnostic and lets capable models inspect files through tools when needed.

### User-facing language

- Keep persona consistent.
- Avoid dedicated extra rendering passes for ordinary replies when the primary lane can generate the final visible text directly.
- A lightweight post-execution wording pass is acceptable when it only rephrases an execution-confirmed result into the configured persona without changing the underlying confirmed facts or side effects.

### Memory organization

- Organize memory by topic.
- Keep notes concise, single-purpose, and easy to scan.
- Prefer one thing per file.
- Prefer bullet facts over long prose.
- Split large notes before they become catch-all dumps.

## Tradeoffs and preferences

### Simplicity bias

- Prefer the fewest moving parts that preserve correctness.
- Simpler structures, fewer state channels, and fewer persistence layers are usually more robust.
- Keep prompts concise and restrained.
- Do not introduce extra persistence layers, queues, or schemas unless they protect a real correctness, scheduling, or recovery boundary.
- Do not maintain derived index layers when the same work can already be expressed cleanly through CLI or direct repository access.

### Evolution and migration

- Prefer cleaner design over preserving accidental structure.
- Do not optimize for backward compatibility by default.
- Avoid shims, dual-read logic, and legacy adapters unless migration requirements demand them.
- When architecture changes, update code and docs to the new source of truth.

### Model evolution

- Treat models as replaceable. Do not bake core correctness into workarounds for the quirks of one weaker model.
- If a weaker model ignores prompt constraints and produces bad output, prefer rejecting, retrying, or failing safely over patching the output into correctness.
- Do not add long-lived workaround logic just to compensate for model weakness when that logic is likely to become obsolete as models improve.
- Avoid carving correctness out of malformed model output with content-specific repair rules; that is usually a brittle, future-hostile workaround.
- Do not paper over user-visible internal-detail leakage with narrow string matches for specific commands, brands, or tokens; prefer stronger prompting, cleaner execution boundaries, or generic structural validation.
- When removing brittle output heuristics, delete them rather than relocating them under a new helper name.
