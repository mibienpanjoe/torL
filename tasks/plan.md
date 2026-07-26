# Implementation Plan: Phase 1 — Production Readiness

## Overview

This plan adds three core production features to torL:
1. **Reconnect dropped connections** — keep a pool of peers and retry failed connections instead of failing immediately.
2. **Periodic peer re-announcement** — re-contact the tracker on its interval to discover fresh peers.
3. **Rarest-first piece selection** — track global piece availability and request the rarest pieces first, improving swarm health and download speed.

Each feature is built as a vertical slice: implementation, tests, and verification.

## Architecture Decisions

- **Tracker returns interval.** `getPeers` will return `{ peers, interval }` so `download.js` can schedule re-announcement.
- **Peer pool in `download.js`.** `download.js` owns the lifecycle of peer sockets: connect, reconnect with backoff, and maintain a minimum number of active connections.
- **Global `RarityMap`.** A new module tracks how many peers have each piece. It is updated when a peer sends a bitfield or `have`, and decremented when a peer disconnects.
- **`Queue` becomes rarity-aware.** Each peer keeps a `Queue` that stores pieces it has. When dequeuing, it asks the `RarityMap` for the rarest piece that is still needed.
- **Test-friendly defaults.** Reconnection delay and tracker interval are configurable via an `options` object so tests can stay fast and deterministic.

## Task List

### Phase 1: Reconnection and Peer Pool

- [ ] Task 1: Reconnect dropped connections
  - **Description:** Refactor `src/download.js` to manage peer connections as a pool. On a failed connection, retry the peer up to a configurable maximum with exponential backoff. Keep a minimum number of active connections. Do not reject the entire download when a single peer drops.
  - **Files likely touched:** `src/download.js`, `tests/download.test.js`
  - **Acceptance criteria:**
    - A single peer failure does not reject the download.
    - Failed peers are retried up to `maxRetries` times.
    - Download resolves when all pieces are received even if some peers fail.
    - All existing tests still pass.
  - **Estimated scope:** Medium (3–5 files)

### Checkpoint: Reconnection
- [ ] `npm test` passes.
- [ ] Mock download still completes with a single peer.
- [ ] Manual review of `download.js` peer lifecycle.

### Phase 2: Periodic Re-Announcement

- [ ] Task 2: Periodic peer re-announcement
  - **Description:** Change `src/tracker.js` to expose the tracker announce `interval`. Update `download.js` to re-announce every `interval` milliseconds and add newly discovered peers to the pool. Clear the interval when the download completes or fails.
  - **Files likely touched:** `src/tracker.js`, `src/download.js`, `tests/tracker.test.js`, `tests/mocks/tracker.js`
  - **Acceptance criteria:**
    - `tracker.getPeers` returns `{ peers, interval }`.
    - `download.js` schedules re-announcement using the interval.
    - Re-announcement stops when the download resolves.
    - Tests can disable or override the interval.
  - **Estimated scope:** Small–Medium (2–3 files)

### Checkpoint: Re-Announcement
- [ ] `npm test` passes.
- [ ] Tracker test verifies interval return value.
- [ ] No dangling timers after download completion.

### Phase 3: Rarest-First Piece Selection

- [ ] Task 3: Rarest-first piece selection
  - **Description:** Add `src/RarityMap.js` to track global piece availability. Update `Queue` to order a peer’s available pieces by rarity. Update `download.js` to feed bitfield/have updates into the `RarityMap` and into each peer’s `Queue`.
  - **Files likely touched:** `src/RarityMap.js`, `src/Queue.js`, `src/download.js`, `tests/Queue.test.js`, `tests/RarityMap.test.js`, `tests/download.test.js`
  - **Acceptance criteria:**
    - A peer with pieces `[0, 1]` and rarity `[1, 0]` requests from piece 1 first.
    - Rarity counts increase when a peer advertises a piece and decrease when it disconnects.
    - `Queue` tests cover both FIFO (no rarity) and rarest-first modes.
    - All tests pass.
  - **Estimated scope:** Medium (3–5 files)

### Checkpoint: Complete
- [ ] All 27+ tests pass.
- [ ] `download.js` peer pool, re-announcement, and rarity map are documented in `AGENTS.md`.
- [ ] Code review passes.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Refactoring `download.js` breaks existing mock tests | High | Keep a simple test verifying single-peer download still works; add targeted tests for reconnection and rarest-first. |
| Rarest-first adds complexity without clear benefit in tiny tests | Low | Only add the feature with explicit unit tests; keep the old FIFO path as default for Queue tests. |
| Re-announcement timers make tests flaky | Medium | Use a configurable interval and clear timers on completion; mock tracker can return a long interval by default. |
| Changing `tracker.getPeers` API requires updating all callers | Low | Project is small; update `download.js` and tests directly. |

## Open Questions

- Should we set a default `minConnections` (e.g., 3) or keep it low for small tests? (Default to 1 for test stability, higher for real CLI usage later.)
- Should we limit total active connections? (Yes, default to 10 for real usage; tests can use a small number.)
- Should reconnection use exponential backoff or a fixed delay? (Exponential backoff, capped at ~30s.)
