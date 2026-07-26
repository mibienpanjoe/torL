# torL Functional Phase — Todo

## Phase 1: Foundation
- [ ] Task 1: Update dependencies and replace `bignum` with `BigInt`
- [ ] Task 2: Set up test infrastructure
- [ ] Task 3: Fix core module bugs

## Checkpoint: Foundation
- [ ] `npm test` runs and all foundation tests pass.
- [ ] No native build dependencies remain.
- [ ] `torrent-parser.js` unit tests pass.

## Phase 2: Core peer/tracker
- [ ] Task 4: Build mock UDP tracker
- [ ] Task 5: Build mock peer

## Checkpoint: Core peer/tracker
- [ ] Mock tracker responds to connect + announce requests.
- [ ] Mock peer completes handshake + serves a piece.
- [ ] Unit tests pass without network.

## Phase 3: Integration
- [ ] Task 6: Fix `download.js` and wire it to mocks
- [ ] Task 7: Real torrent integration test
- [ ] Task 8: Update `AGENTS.md`

## Checkpoint: Complete
- [ ] Mock end-to-end download works.
- [ ] Real torrent download works (user-provided torrent).
- [ ] All tests pass.

## Task details

See `tasks/plan.md` for full descriptions, risks, and architecture decisions.
