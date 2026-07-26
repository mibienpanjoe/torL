# Implementation Plan: Phase 1 — Production Readiness

## Overview

This plan adds three core production features to torL:
1. **Reconnect dropped connections** — keep a pool of peers and retry failed connections instead of failing immediately.
2. **Periodic peer re-announcement** — re-contact the tracker on its interval to discover fresh peers.
3. **Rarest-first piece selection** — track global piece availability and request the rarest pieces first, improving swarm health and download speed.

Each feature is built as a vertical slice: implementation, tests, and verification.

## Architecture Decisions

- **Tracker returns interval.** `getPeers` callback receives `(peers, interval)` where `interval` is in seconds. `download.js` converts it to milliseconds.
- **Tracker accepts an `AbortSignal`.** Pending tracker requests can be cancelled on shutdown.
- **Peer pool in `download.js`.** `download.js` owns the lifecycle of peer sockets: connect, reconnect with exponential backoff, dedupe peers, and maintain a configurable number of active connections.
- **Global `RarityMap`.** A new module tracks how many peers have each piece. It is updated when a peer sends a bitfield or `have`, and decremented when a peer disconnects.
- **`Queue` becomes rarity-aware.** Each peer keeps a `Queue` that stores pieces it has. When dequeuing, it asks the `RarityMap` for the rarest piece that is still needed.
- **Test-friendly defaults.** Reconnection delay and tracker interval are configurable via a `download` `options` object so tests can stay fast and deterministic.

## Task List

### Phase 1: Reconnection and Peer Pool

- [x] Task 1: Reconnect dropped connections
  - **Description:** Refactor `src/download.js` to manage peer connections as a pool. On a failed connection, retry the peer up to a configurable maximum with exponential backoff. Dedupe peers to avoid redundant connections. Do not reject the entire download when a single peer drops.
  - **Files likely touched:** `src/download.js`, `tests/download.test.js`, `tests/mocks/peer.js`
  - **Acceptance criteria:**
    - A single peer failure does not reject the download.
    - Failed peers are retried up to `maxRetries` times.
    - Download resolves when all pieces are received even if some peers fail.
    - All existing tests still pass.
  - **Estimated scope:** Medium (3–5 files)

### Checkpoint: Reconnection
- [x] `npm test` passes.
- [x] Mock download still completes with a single peer.
- [x] `download.test.js` has a reconnection test.

### Phase 2: Periodic Re-Announcement

- [x] Task 2: Periodic peer re-announcement
  - **Description:** Change `src/tracker.js` to expose the tracker announce `interval` (seconds) and accept an `AbortSignal`. Update `download.js` to re-announce every `interval` seconds and add newly discovered peers to the pool. Cancel pending tracker requests and clear timers when the download completes or fails.
  - **Files likely touched:** `src/tracker.js`, `src/download.js`, `tests/tracker.test.js`, `tests/mocks/tracker.js`, `tests/mocks/peer.js`
  - **Acceptance criteria:**
    - `tracker.getPeers` callback receives `(peers, interval)`.
    - `download.js` schedules re-announcement using the interval.
    - Re-announcement stops when the download resolves.
    - Tests can override the interval via `options.announceInterval`.
  - **Estimated scope:** Small–Medium (2–3 files)

### Checkpoint: Re-Announcement
- [x] `npm test` passes.
- [x] Tracker test verifies interval return value.
- [x] No dangling timers or sockets after download completion.

### Phase 3: Rarest-First Piece Selection

- [x] Task 3: Rarest-first piece selection
  - **Description:** Add `src/RarityMap.js` to track global piece availability. Update `Queue` to order a peer’s available pieces by rarity. Update `download.js` to feed bitfield/have updates into the `RarityMap` and into each peer’s `Queue`.
  - **Files likely touched:** `src/RarityMap.js`, `src/Queue.js`, `src/download.js`, `tests/Queue.test.js`, `tests/RarityMap.test.js`
  - **Acceptance criteria:**
    - A peer with pieces `[0, 1]` and rarity `[2, 1]` requests from piece 1 first.
    - Rarity counts increase when a peer advertises a piece and decrease when it disconnects.
    - `Queue` tests cover rarest-first ordering.
    - All tests pass.
  - **Estimated scope:** Medium (3–5 files)

### Checkpoint: Complete
- [x] All 34 tests pass.
- [x] `download.js` peer pool, re-announcement, and rarity map are documented in `AGENTS.md`.
- [x] Code review passes.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Refactoring `download.js` breaks existing mock tests | High | All existing tests still pass; added targeted tests for reconnection and re-announcement. |
| Rarest-first adds complexity without clear benefit in tiny tests | Low | Explicit unit tests for `RarityMap` and rarity-aware `Queue`; FIFO path removed to simplify code. |
| Re-announcement timers/sockets make tests hang | Medium | Use `AbortSignal` and recursive timeouts; clear/cancel everything on completion; dedupe peers. |
| Changing `tracker.getPeers` API requires updating all callers | Low | Project is small; all callers updated. |

## Open Questions

- Default `maxConnections` is 10. Is that reasonable for real usage? (Can be tuned later; tests do not depend on it.)
- Reconnection uses exponential backoff capped at 30s. Is that too aggressive for real swarms? (Acceptable first pass; can be tuned later.)
