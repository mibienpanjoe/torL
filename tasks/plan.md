# Implementation Plan: Magnet Download Reliability

## Overview

Magnet links fail before any file download starts. The TUI only shows `Download failed: exit status 1` because the real CLI error is swallowed. Root cause analysis shows multiple bugs in peer discovery and magnet resolution — not a bad magnet link (KTorrent proves the swarm exists).

## Root Cause Analysis

### What the user sees
```
Download failed: exit status 1
```
This comes from the TUI when `torl-cli` exits non-zero. The actual error (`No peers found for magnet link` or `Failed to download metadata from any peer: ...`) is written to stderr and only briefly appears in the TUI Messages panel — then lost.

### Failure pipeline (magnet → download)

```
magnet URL
  → parseMagnetLink          ✅ works (info hash + trackers)
  → resolveMagnet
      → collectPeers
          → trackers         ❌ bugs (see below)
          → DHT              ⚠️ weak / sequential after trackers
      → downloadMetadata     ⚠️ only runs if peers found
  → download(torrent)        never reached
```

### Bug 1 — Tracker stops on first empty success (CRITICAL)

`tracker.js` `tryTrackers` calls `callback(peers)` as soon as **any** tracker responds successfully — even with **0 peers**.

So if tracker #1 answers quickly with an empty list, trackers #2–#11 are **never contacted**.

KTorrent contacts many trackers; torl may stop after the first empty response.

### Bug 2 — Wrong key after magnet resolve (CRITICAL)

`buildTorrentFromMagnet` sets:
```js
announceList: [...]   // camelCase
```
but `tracker.js` / download path read:
```js
torrent['announce-list']   // BEP hyphenated key
```

Even if metadata download succeeds, the **file download** phase only uses `announce` (first tracker).

### Bug 3 — Peer collection is sequential and incomplete

`collectPeers` does:
1. Wait for **all** tracker attempts (sequential, 15s each on timeout)
2. **Then** start DHT

Problems:
- Slow (up to minutes)
- DHT never runs in parallel with trackers
- If trackers return early with `[]` (Bug 1), DHT may still help — but DHT bootstrap is weak and has no overall deadline

### Bug 4 — Magnet announce uses `left=0`

Magnet stub has `info.length = 0` (no `xl=`). Tracker announce sends `left=0`, which many trackers interpret as “seeder”. Seeders often get fewer/no peers.

Should announce with `left = -1` (unknown) or a large value when size is unknown.

### Bug 5 — TUI hides the real error

`torl-cli` prints the real error on stderr. TUI `cmd.Wait()` only surfaces `exit status 1`. User cannot diagnose without running `torl-cli` manually.

### Bug 6 — No magnet-resolution progress events

During resolve (can take 30–120s), no JSON events are emitted. TUI sits on “Starting…” then dies. No “contacting trackers / DHT / downloading metadata” feedback.

### Why KTorrent works

- Queries many trackers in parallel
- Uses DHT aggressively with a large routing table
- Does not stop on first empty tracker response
- Correct left/numwant announce semantics
- Longer, smarter timeouts

## Architecture Decisions

1. **Keep trying trackers until peers are found or the list is exhausted** — empty success is not success.
2. **Run trackers + DHT in parallel** with a shared deadline (e.g. 45s).
3. **Normalize torrent object keys** — always use `announce-list` (BEP form) after magnet resolve.
4. **Surface CLI stderr in TUI final error** so users see the real message.
5. **Emit JSON status events** during magnet resolution for TUI feedback.

## Task List

### Phase 1: Fix peer discovery (must-have for magnet to start)

#### Task 1: Do not stop tracker fallback on empty peer lists
**Files:** `src/tracker.js`, `tests/tracker.test.js`

- If a tracker responds with 0 peers, treat as soft-failure and try the next URL.
- Only call final callback with peers when `peers.length > 0`, or when all URLs are exhausted (then `[]`).
- Add test: first tracker returns empty list, second returns peers → gets peers from second.

**Acceptance:**
- [ ] Empty tracker response continues to next tracker
- [ ] Test covers empty-then-success fallback

#### Task 2: Parallel tracker queries with short timeout
**Files:** `src/tracker.js`, `tests/tracker.test.js`

- Query trackers in parallel batches (e.g. 4 at a time) with ~5s timeout each.
- Return as soon as any tracker yields peers.
- Keep sequential fallback only as optional fallback if needed.

**Acceptance:**
- [ ] Multiple trackers contacted concurrently
- [ ] First non-empty result wins
- [ ] Worst-case magnet tracker phase << 15s × N

#### Task 3: Fix magnet → torrent announce-list key
**Files:** `src/magnet-resolver.js`, `src/magnet-parser.js`, tests

- `buildTorrentFromMagnet` must set `'announce-list'` (and keep `announce`).
- Align `magnetLinkToTorrent` the same way.
- Ensure `download.js` `hasTracker` checks announce **or** announce-list.

**Acceptance:**
- [ ] Resolved magnet torrents include `announce-list` with all magnet trackers
- [ ] File-download phase uses full tracker list

#### Task 4: Correct announce `left` for unknown size
**Files:** `src/tracker.js`

- When size is 0/unknown (magnet stub), send `left = -1` (or max uint64) so trackers treat client as leecher.
- HTTP announce: same fix for `left=` query param.

**Acceptance:**
- [ ] Magnet peer discovery announces as leecher, not seeder

#### Task 5: Parallelize trackers + DHT in magnet resolve
**Files:** `src/magnet-resolver.js`, `src/download.js` (optional shared helper)

- `collectPeers`: start tracker fan-out and DHT lookup together.
- Merge peers as they arrive; stop early when enough peers for metadata (e.g. ≥ 5) or deadline hits (e.g. 45s).
- Add overall timeout so resolve never hangs forever.

**Acceptance:**
- [ ] DHT runs even while trackers are in flight
- [ ] Resolve fails fast with a clear error after deadline

### Phase 2: Metadata exchange robustness

#### Task 6: Try metadata peers concurrently
**Files:** `src/magnet-resolver.js`, `src/metadata-downloader.js`

- Instead of serial peer attempts, try up to N peers in parallel (e.g. 5).
- First successful metadata wins; cancel others.
- Slightly longer per-peer timeout (15–20s).

**Acceptance:**
- [ ] Metadata succeeds if any one of several peers has it
- [ ] Mock tests still pass

### Phase 3: Observability (so failures are debuggable)

#### Task 7: Emit JSON status events during magnet resolve
**Files:** `src/cli.js`, `src/magnet-resolver.js`, TUI event parser

Events like:
```json
{"type":"status","id":"...","message":"Resolving magnet…"}
{"type":"status","id":"...","message":"Found 12 peers, downloading metadata…"}
```

**Acceptance:**
- [ ] TUI shows resolving status before download progress
- [ ] CLI `--json` emits status lines

#### Task 8: TUI surfaces real CLI error on failure
**Files:** `tui/torl/model.go`, `tui/main.go`

- Capture last non-empty stderr lines from `torl-cli`.
- On process exit error, report those lines (or joined message), not only `exit status 1`.

**Acceptance:**
- [ ] User sees e.g. `No peers found for magnet link` instead of bare exit status

### Phase 4: Verify and ship

#### Task 9: Integration tests
- Tracker empty-response fallback
- Magnet stub uses full announce-list
- Parallel peer collection unit test with mocks
- Metadata concurrent attempt test (optional mock)

#### Task 10: Manual verification on user machine
```bash
torl-cli --json 'magnet:?xt=urn:btih:2f672fdde867b2ec9db189259c38376db3f6d545&tr=...'
torl 'magnet:...'
```
Expect: status events → start event with torrent name → progress.

#### Task 11: Version bump + release
- Publish as `torl-client@1.1.0` (behavior fix worth minor bump)

## Implementation Order

| Order | Task | Why first |
|------:|------|-----------|
| 1 | Task 1 — empty tracker fallback | Most likely why swarm is missed |
| 2 | Task 3 — announce-list key | Breaks post-metadata download too |
| 3 | Task 4 — left=-1 | Improves tracker peer returns |
| 4 | Task 5 — parallel trackers+DHT | Speed + DHT contribution |
| 5 | Task 2 — parallel tracker batches | Speed |
| 6 | Task 6 — parallel metadata | Finish resolve reliably |
| 7 | Task 8 — TUI real errors | Debuggability |
| 8 | Task 7 — status events | UX |
| 9 | Tasks 9–11 — tests + ship | |

## Success Criteria

- [ ] Same magnet that works in KTorrent reaches `type:start` with a real torrent name in torl
- [ ] Progress events appear and pieces download
- [ ] Failure messages name the actual problem (no peers / metadata / etc.)
- [ ] All existing tests pass; new tests cover empty-tracker fallback and announce-list

## Risks

| Risk | Mitigation |
|------|------------|
| Aggressive parallel announces rate-limited by trackers | Cap concurrency (3–5); jitter |
| DHT still weak vs full clients | Parallel + longer deadline; trackers carry most weight |
| Breaking existing single-tracker torrents | Keep announce path; add tests |

## Out of scope (later)

- Full DHT routing table persistence
- uTP / IPv6
- Magnet v2 hybrid only
- WebTorrent / browser trackers
