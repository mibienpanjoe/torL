# torL Functional Phase — Todo

## Phase 1: Foundation
- [x] Task 1: Update dependencies and replace `bignum` with `BigInt`
- [x] Task 2: Set up test infrastructure
- [x] Task 3: Fix core module bugs

## Checkpoint: Foundation
- [x] `npm test` runs and all foundation tests pass.
- [x] No native build dependencies remain.
- [x] `torrent-parser.js` unit tests pass.

## Phase 2: Core peer/tracker
- [x] Task 4: Build mock UDP tracker
- [x] Task 5: Build mock peer

## Checkpoint: Core peer/tracker
- [x] Mock tracker responds to connect + announce requests.
- [x] Mock peer completes handshake + serves a piece.
- [x] Unit tests pass without network.

## Phase 3: Integration
- [x] Task 6: Fix `download.js` and wire it to mocks
- [x] Task 7: Real torrent integration test
- [x] Task 8: Update `AGENTS.md`

## Checkpoint: Complete
- [x] Mock end-to-end download works.
- [x] Live HTTP tracker connectivity verified against Debian netinst torrent.
- [x] All tests pass.

## Task details

See `tasks/plan.md` for full descriptions, risks, and architecture decisions.
