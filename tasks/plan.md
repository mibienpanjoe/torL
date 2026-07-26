# Implementation Plan: Phase 3 — DHT Peer Discovery

## Overview

Add support for the BitTorrent Mainline DHT (BEP 5) so torL can discover peers without relying on a centralized tracker. This phase focuses on a minimal but functional DHT client: bootstrap and iterative `get_peers` lookup. `announce_peer` and NAT traversal are explicitly out of scope for this first pass because they are environment-dependent and require additional work.

## Architecture Decisions

- **`src/dht.js` is a standalone DHT client.** It owns a UDP socket, maintains a simple routing table of known DHT nodes, and exposes `findPeers(torrent, callback)`.
- **Simple routing table.** A fixed-size sorted list of known good nodes ordered by XOR distance to our own node ID. No full K-bucket split/merge logic in this first pass.
- **Iterative lookups.** For each info hash, perform an iterative `find_node` / `get_peers` search, querying the closest known nodes and following closer contacts until peers are found or no closer nodes remain.
- **Bootstrap routers.** Use well-known public DHT routers (e.g., `router.bittorrent.com:6881`, `dht.transmissionbt.com:6881`) to seed the routing table.
- **DHT client lifecycle.** `DHTClient` is created per download, started before the lookup, and stopped once peers are returned or the download completes.
- **Integration with `download.js`.** `download()` queries both the tracker and DHT in parallel when `useDHT` is true (the default). If the torrent has no tracker, DHT is the only peer source.
- **Mock DHT node for tests.** A local UDP responder that answers `ping`, `find_node`, `get_peers`, and `announce_peer` so the lookup is deterministic.

## Task List

### Phase 3.1: DHT primitives
- [x] Task 1: DHT message encoding/decoding and node ID utilities
  - **Description:** Add `src/dht.js` with functions to generate a random 20-byte node ID, encode/decode BEP 5 packets (ping, find_node, get_peers, announce_peer, and responses), and compute XOR distance between node IDs.
  - **Files likely touched:** `src/dht.js`, `tests/dht.test.js`
  - **Acceptance criteria:**
    - Can encode and decode each DHT message type.
    - Transaction IDs are round-tripped correctly.
    - Node IDs are 20 bytes.
  - **Estimated scope:** Small–Medium (2–3 files)

### Checkpoint: DHT primitives
- [x] `npm test` passes.
- [x] Unit tests cover all message types.

### Phase 3.2: Bootstrap and simple routing table
- [x] Task 2: Bootstrap and routing table
  - **Description:** Maintain a list of known DHT nodes. Send `ping` to bootstrap routers to confirm they are alive. Add responsive nodes to the routing table sorted by XOR distance to our own node ID.
  - **Files likely touched:** `src/dht.js`, `tests/dht.test.js`
  - **Acceptance criteria:**
    - Bootstrap `ping` is sent to configured routers.
    - Responsive nodes are stored in the routing table.
    - Routing table stays sorted by distance.
  - **Estimated scope:** Medium (2–3 files)

### Phase 3.3: Iterative peer lookup
- [x] Task 3: Iterative `get_peers` lookup
  - **Description:** Implement iterative lookup: query the closest known nodes for `get_peers`, collect returned peers, and follow closer nodes returned in `nodes` until peers are found or the search exhausts closer candidates.
  - **Files likely touched:** `src/dht.js`, `tests/dht.test.js`, `tests/mocks/dht.js`
  - **Acceptance criteria:**
    - A mock DHT network with multiple nodes can be traversed.
    - The client returns the peer list once found.
    - The lookup terminates when no closer nodes are found.
  - **Estimated scope:** Medium–Large (3–5 files)

### Checkpoint: Iterative lookup
- [x] `npm test` passes.
- [x] Mock DHT lookup test passes.

### Phase 3.4: Integration
- [x] Task 4: Wire DHT into `download.js`
  - **Description:** Update `download.js` to query DHT when the torrent has no tracker or as a fallback.
  - **Files likely touched:** `src/download.js`, `tests/download.test.js`
  - **Acceptance criteria:**
    - A torrent without a tracker can find peers via DHT.
    - DHT socket is closed when peers are returned.
    - Existing tracker-based tests still pass.
  - **Estimated scope:** Medium (2–3 files)

### Checkpoint: Complete
- [x] All 56 tests pass.
- [x] `AGENTS.md` updated.
- [x] Code review passes.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| DHT implementation is large and error-prone | High | Keep the first pass minimal: simple routing table, no K-bucket splits, focus on `get_peers`. |
| Live DHT tests are flaky behind NAT/firewalls | High | Use a mock DHT network for all automated tests; live DHT is manual only. |
| Integrating DHT with `download.js` complicates peer sourcing | Medium | Treat DHT as an additional peer source; keep tracker path unchanged. |
| Bootstrapping requires internet access | Medium | Tests use local mock routers; live bootstrap is optional. |

## Open Questions

- DHT runs in parallel with the tracker lookup. Is this too aggressive for small swarms? (Current default is fine; can be disabled via `useDHT: false`.)
- Routing table is not persisted to disk. Should we persist it for faster restarts? (Not in this phase; bootstrap each run.)
- `announce_peer` is not implemented. Should we add it later so the client contributes to the DHT? (Yes, but out of scope for this phase.)
