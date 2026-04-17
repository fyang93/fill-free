# tasks.json Positioning Audit

Audit under the principle that simpler structures are usually more robust.

## Question

What should `tasks.json` be for if we optimize for the fewest moving parts that still preserve correctness?

## Conclusion

`tasks.json` should not be the general execution bus for all side effects.

It should be kept only for work that truly needs at least one of:
- delayed execution
- background execution
- durable recovery after process interruption
- explicit queue semantics

If a side effect can be completed synchronously and reliably during the current executor turn, it should usually not go through `tasks.json`.

## Current task uses

### 1. Schedule follow-up preparation
Current code:
- event creation writes directly to `system/events.json`
- only follow-up preparation queues `schedules.prepare-delivery-text`

Assessment:
- this now matches the intended boundary
- schedule creation no longer needs queue semantics

Recommendation:
- keep `schedules.prepare-delivery-text` in `tasks.json`

### 2. Message delivery
Current code:
- immediate delivery logic lives on the bot/runtime side
- `src/bot/tasks/runtime/handlers/messages.ts` remains for scheduled queued delivery

Assessment:
- this is now aligned with the intended queue boundary
- only delayed delivery still uses `tasks.json`

Recommendation:
- keep this split

### 3. Temporary authorization grants
Current code:
- executor writes pending authorization state directly

Assessment:
- this now matches the intended architecture
- only future expiry/revocation work would justify queue semantics later

Recommendation:
- keep direct writes for grant creation
- reserve queued work only for actual delayed expiry handling if that appears

### 4. Repo query answers
Current code:
- executor runs `query.answer-from-repo` directly during the current turn

Assessment:
- this is now aligned with the intended architecture

Recommendation:
- keep direct execution unless a truly asynchronous query path appears later

### 5. User access-level changes
Current code:
- executor applies `access.set-access-level` directly

Assessment:
- this now matches the intended architecture

Recommendation:
- keep direct execution

### 6. Schedule mutation tasks
Current code:
- update / delete / pause / resume execute directly

Assessment:
- local schedule mutations no longer need the queue

Recommendation:
- keep them direct unless a real async boundary appears

## Suggested target positioning

### Keep in tasks.json
- `schedules.prepare-delivery-text`
- future scheduled outbound deliveries
- any truly delayed or background maintenance work

### Still worth reviewing for further removal
- no current synchronous local mutation remains queued by default
- future review should focus on whether any new queued work still reflects a real async boundary

## Practical simplification rule

Before introducing or keeping a queued task, ask:

1. Does this work need to survive process interruption before it runs?
2. Does it need to run later rather than now?
3. Does it need explicit queue ordering or retry semantics?
4. Would direct execution make the system simpler without weakening correctness?

If the answer to the first three is no, prefer direct execution.

## Summary

Under the simplification-first principle, `tasks.json` should shrink into a narrow durable async backend.

It should not remain the default path for ordinary synchronous local mutations.
