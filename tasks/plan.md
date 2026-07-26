# Implementation Plan: torL Functional Phase

## Overview
Make the torL BitTorrent client functional by fixing core bugs, replacing native dependencies, adding tests, and validating end-to-end downloads with both a mock peer/tracker and a real torrent.

## Architecture Decisions
- Replace `bignum` with native `BigInt` to remove the native build dependency.
- Upgrade `bencode` to the latest version and adapt to any API changes.
- Use Node.js built-in `node:test` / `node:assert` for tests.
- Build a local mock UDP tracker and a mock peer so tests run without internet.
- Keep CommonJS modules as the existing project convention.

## Task List

### Phase 1: Foundation
- [ ] Task 1: Update dependencies and replace `bignum` with `BigInt`
- [ ] Task 2: Set up test infrastructure
- [ ] Task 3: Fix core module bugs

### Checkpoint: Foundation
- [ ] `npm test` runs and all foundation tests pass.
- [ ] No native build dependencies remain.
- [ ] `torrent-parser.js` unit tests pass.

### Phase 2: Core peer/tracker
- [ ] Task 4: Build mock UDP tracker
- [ ] Task 5: Build mock peer

### Checkpoint: Core peer/tracker
- [ ] Mock tracker responds to connect + announce requests.
- [ ] Mock peer completes handshake + serves a piece.
- [ ] Unit tests pass without network.

### Phase 3: Integration
- [ ] Task 6: Fix `download.js` and wire it to mocks
- [ ] Task 7: Real torrent integration test
- [ ] Task 8: Update `AGENTS.md`

### Checkpoint: Complete
- [ ] Mock end-to-end download works.
- [ ] Real torrent download works (user-provided torrent).
- [ ] All tests pass.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Latest `bencode` API changes from v2 | Medium | Read docs and tests with a fixture torrent. |
| No Node.js available in this environment | Medium | Make code changes testable; defer runtime verification to the user's environment. |
| User-provided torrent unavailable or uses unsupported features | Medium | Verify with mocks first; ask user about tracker type if integration fails. |
| Native `bignum` behavior differs from `BigInt` for edge cases | Low | Add unit tests for `size` and `pieceLen` boundary cases. |

## Open Questions
- What torrent file will the user provide? (single-file vs multi-file, public vs private, UDP vs HTTP tracker)
