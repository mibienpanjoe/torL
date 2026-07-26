# AGENTS.md

## Project overview
- Node.js BitTorrent client, **ESM** (`"type": "module"` in `package.json`).
- CLI entry point: `node index.js <torrent-file>`; output is written to the torrent's `info.name` path.
- Supports single-file and multi-file torrents via UDP and HTTP trackers.
- No README or other docs; the code is the only source of truth.

## Developer commands
- `npm test` runs the full test suite using the built-in `node:test` runner.
- `npm test -- tests/<file>.test.js` runs a single test file.
- No build, lint, or formatter scripts exist.
- `npm install` is plain JS dependencies; no native build toolchain is required.

## Environment
- Target the latest Node.js LTS / current version.
- Node is installed via `nvm` in this environment (`source ~/.nvm/nvm.sh && nvm use 24`).

## Architecture notes
- `src/torrent-parser.js` decodes bencoded torrent files and converts `Uint8Array` byte strings to `Buffer` for compatibility with the rest of the code.
- `src/tracker.js` supports both UDP and HTTP trackers and accepts an optional `AbortSignal`.
- `src/download.js` returns a `Promise`, manages peer sockets as a pool with reconnection/backoff, periodically re-announces to the tracker, and uses a global `RarityMap` for rarest-first piece selection.
- `src/Queue.js` stores the pieces each peer has and requests the rarest needed piece first.
- `src/RarityMap.js` tracks global piece availability across connected peers.
- `tests/mocks/` contains a local UDP tracker and TCP peer for fast, deterministic integration tests.

## Dependencies
- `bencode` is the only runtime dependency (updated to the latest ESM-only version).
- `bignum` and `save` were removed; `BigInt` handles the few large-integer cases.

## Live integration
- `tests/live-tracker.test.js` verifies HTTP tracker connectivity against the Debian `debian-13.6.0-amd64-netinst.iso` torrent.
- Live peer downloading was tested manually but is environment-dependent and flaky behind NAT/firewalls; mock peer tests cover the peer-wire protocol deterministically.
