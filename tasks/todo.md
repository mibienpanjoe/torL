# torL Phase 1 — Production Readiness

## Phase 1: Reconnection and Peer Pool
- [x] Task 1: Reconnect dropped connections
  - Refactor `src/download.js` to manage peer sockets as a pool.
  - Retry failed connections up to `maxRetries` with exponential backoff.
  - Keep a minimum number of active connections.
  - Do not reject the whole download when one peer fails.

## Checkpoint: Reconnection
- [x] `npm test` passes.
- [x] Single-peer download test still works.
- [x] Reconnection download test passes.

## Phase 2: Periodic Re-Announcement
- [x] Task 2: Periodic peer re-announcement
  - Update `src/tracker.js` to return `{ peers, interval }` and accept an `AbortSignal`.
  - Schedule re-announcement in `src/download.js`.
  - Clear timers and abort pending tracker requests on completion.
  - Update tests/mocks to support configurable intervals and announce counting.

## Checkpoint: Re-Announcement
- [x] `npm test` passes.
- [x] Tracker test verifies interval.
- [x] No dangling timers or sockets.

## Phase 3: Rarest-First Piece Selection
- [x] Task 3: Rarest-first piece selection
  - Add `src/RarityMap.js` to track global piece availability.
  - Update `src/Queue.js` to order pieces by rarity.
  - Update `src/download.js` to feed bitfield/have/disconnect into `RarityMap`.
  - Add unit tests for `RarityMap` and rarity-aware `Queue`.

## Checkpoint: Complete
- [x] All 34 tests pass.
- [x] `AGENTS.md` updated.

## Plan

See `tasks/plan.md` for full architecture decisions, acceptance criteria, and risks.
