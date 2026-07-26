# torL Phase 3 — DHT Peer Discovery

## Phase 3.1: DHT Primitives
- [x] DHT message encoding/decoding and node ID utilities
  - Added `src/dht.js` with node ID generation, XOR distance, BEP 5 encode/decode, and compact node/peer parsing.
  - Added `tests/dht.test.js` for ping, find_node, get_peers, announce_peer, and responses.

## Checkpoint: DHT Primitives
- [x] `npm test` passes.
- [x] Unit tests cover all message types.

## Phase 3.2: Bootstrap and Routing Table
- [x] Bootstrap and routing table
  - `DHTClient` maintains a simple sorted list of known DHT nodes and bootstraps from public routers.

## Phase 3.3: Iterative Peer Lookup
- [x] Iterative `get_peers` lookup
  - Implemented traversal of the DHT to find peers for an info hash.
  - Added `tests/mocks/dht.js` mock DHT network.
  - Added `tests/dht-integration.test.js` for end-to-end lookup.

## Checkpoint: Iterative Lookup
- [x] `npm test` passes.
- [x] Mock DHT lookup test passes.

## Phase 3.4: Integration
- [x] Wire DHT into `download.js`
  - `download()` queries both tracker and DHT when enabled.
  - DHT is used as a fallback when the torrent has no tracker.
  - Added `download` test that downloads a torrent solely via DHT.

## Checkpoint: Complete
- [x] All 56 tests pass.
- [x] `AGENTS.md` updated.

## Plan

See `tasks/plan.md` for full architecture decisions, acceptance criteria, and risks.
