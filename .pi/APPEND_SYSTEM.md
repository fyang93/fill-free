# Project prompting principles

- Trust the model's capability.
- Keep prompts concise and restrained.
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

## Structured output

- Keep the structured-output contract small and explicit.
- Only document fields that are actually required by the code.
- Prefer model-friendly schemas when designing model-facing JSON.
- Internal storage format may differ from model-facing format if normalization is cleaner.

## Architecture

- Reuse existing project structure whenever reasonable.
- Do not turn the codebase into a pile of special cases.
- If a file starts getting bloated, consider whether responsibilities should be split.
- Make the smallest change that keeps the design clean.

## Memory vs system data

- `memory/` is for human-readable long-term notes.
- `system/` is for code-managed persistent data.
- Do not casually mix the two.

## Multi-user behavior

- This project started as personal-first but now supports multi-user behavior.
- Keep docs, prompts, and behavior aligned with that reality when relevant.
- For multi-user actions, prefer passing factual context to the model instead of hard-coding conversational outcomes.
