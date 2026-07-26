# torL Phase 1 — Production Readiness

## Phase 1: Reconnection and Peer Pool
- [ ] Task 1: Reconnect dropped connections
  - Refactor `src/download.js` to manage peer sockets as a pool.
  - Retry failed connections up to `maxRetries` with exponential backoff.
  - Keep a minimum number of active connections.
  - Do not reject the whole download when one peer fails.

## Checkpoint: Reconnection
- [ ] `npm test` passes.
- [ ] Single-peer download test still works.

## Phase 2: Periodic Re-Announcement
- [ ] Task 2: Periodic peer re-announcement
  - Update `src/tracker.js` to return `{ peers, interval }`.
  - Schedule re-announcement in `src/download.js`.
  - Clear timers on completion.
  - Update tests/mocks to support configurable intervals.

## Checkpoint: Re-Announcement
- [ ] `npm test` passes.
- [ ] Tracker test verifies interval.
- [ ] No dangling timers.

## Phase 3: Rarest-First Piece Selection
- [ ] Task 3: Rarest-first piece selection
  - Add `src/RarityMap.js` to track global piece availability.
  - Update `src/Queue.js` to order pieces by rarity.
  - Update `src/download.js` to feed bitfield/have/disconnect into `RarityMap`.
  - Add unit tests for `RarityMap` and rarity-aware `Queue`.

## Checkpoint: Complete
- [ ] All 27+ tests pass.
- [ ] `AGENTS.md` updated.

## Plan

See `tasks/plan.md` for full architecture decisions, acceptance criteria, and risks.
