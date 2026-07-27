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
- `src/dht.js` implements a minimal BitTorrent Mainline DHT (BEP 5) client with bootstrap, iterative `get_peers` lookup, and peer discovery without trackers.
- `src/download.js` returns a `Promise`, manages peer sockets as a pool with reconnection/backoff, periodically re-announces to the tracker, uses a global `RarityMap` for rarest-first piece selection, and falls back to DHT when no tracker is present.
- `src/Queue.js` stores the pieces each peer has and requests the rarest needed piece first.
- `src/RarityMap.js` tracks global piece availability across connected peers.
- `src/state.js` and `src/verify.js` support pause/resume: a `<target>.torl.state` file stores the completed bitfield, and existing files are SHA1-verified on restart.
- `src/nat.js` provides NAT traversal with UPnP IGD (SSDP discovery + SOAP AddPortMapping/DeletePortMapping), NAT-PMP (RFC 6886), and a unified `mapPort`/`unmapPort` that tries UPnP first then NAT-PMP.
- `src/magnet-parser.js` parses magnet links (hex and base32 info hashes, display name, tracker URLs).
- `src/metadata-downloader.js` downloads the `.torrent` info dictionary from a peer via the BEP 10 extension protocol + BEP 9 metadata exchange.
- `src/magnet-resolver.js` resolves a magnet link to a full torrent object by discovering peers (trackers + DHT) and downloading metadata.
- `index.js` is the CLI entry point (with `#!/usr/bin/env node`) and accepts either a `.torrent` file path or a `magnet:` link; use `-o <dir>` to set the output directory.
- `src/cli.js` implements the command-line interface with `--help`, `--version`, `--output`, `--quiet`, and `--json` flags.
- `package.json` exposes the `torl` binary via `index.js` and declares Node.js `>=20.0.0` as the engine requirement.
- `tui/` is a Go module with a Bubble Tea TUI (`torl-tui`) that spawns `torl --json` and displays progress, peers, and status. It accepts both `.torrent` files and `magnet:` links, builds to a single binary, and requires `torl` in `PATH` or a `--torl-path` override. Running `npm install` will build `torl-tui` automatically if Go is installed; otherwise use `npm run build-tui` after installing Go.
- `tests/mocks/` contains a local UDP tracker, TCP peer, DHT node, UPnP gateway, NAT-PMP gateway, and metadata peer for fast, deterministic integration tests.

## Dependencies
- `bencode` is the only runtime dependency (updated to the latest ESM-only version).
- `bignum` and `save` were removed; `BigInt` handles the few large-integer cases.

## Live integration
- `tests/live-tracker.test.js` verifies HTTP tracker connectivity against the Debian `debian-13.6.0-amd64-netinst.iso` torrent.
- Live peer downloading was tested manually but is environment-dependent and flaky behind NAT/firewalls; mock peer tests cover the peer-wire protocol deterministically.
