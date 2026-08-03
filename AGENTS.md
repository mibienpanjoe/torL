# AGENTS.md

Source of truth for agent context. README.md and CONTRIBUTING.md are for human contributors.

## Tech stack
- Node.js >= 20 (ESM only: `"type": "module"`). Prefer current LTS via nvm: `source ~/.nvm/nvm.sh && nvm use 24`.
- Single runtime dependency: `bencode` (ESM). Use native `BigInt` — never reintroduce `bignum`.
- Optional Go >= 1.22 TUI: Bubble Tea in `tui/`.
- Tests: built-in `node:test` + `node:assert` (no Jest/Mocha/Vitest). Go: `go test ./...` in `tui/`.

## Commands
- `npm test` — full Node suite
- `npm test -- tests/<file>.test.js` — single file
- `npm test -- tests/live-tracker.test.js` — live network (optional, flaky behind NAT)
- `npm run build-tui` — build Go TUI binary
- `cd tui && go test ./...` — Go unit tests
- `cd tui && go build -o torl-tui .` — manual TUI build
- `npm install` — deps + download prebuilt `torl-tui` for package version (fallback: build from source if Go present)
- No separate lint/typecheck scripts; correctness gate is `npm test` (+ `go test` when touching `tui/`).

## Code conventions
- `'use strict';` at the top of every JS file.
- ESM imports with explicit `.js` extensions (`import x from './foo.js'`).
- Named exports for utilities; default export OK for the main class/function of a module.
- Convert `Uint8Array` byte strings from bencode to `Buffer` early (see `src/torrent-parser.js`).
- Prefer small focused functions; follow naming/style in the file you edit.
- Tests mirror source: `src/download.js` → `tests/download.test.js`.
- Use `tests/mocks/` for deterministic peer/tracker/DHT/NAT/metadata tests; clean up temp dirs in `finally`.
- Keep live network tests separate and clearly named.

## Boundaries
- Do not add runtime dependencies without a strong reason (project is intentionally minimal).
- Do not commit secrets, `.env`, large binaries, or built `torl-tui` artifacts.
- Do not invent a test framework or bundler.
- Ask before changing public CLI flags, npm package surface, or release workflow.
- Prefer mock-based tests; do not rely on live peers for CI correctness.
- When editing TUI behavior, also update Go tests under `tui/torl/`.

## Project map

### Entry points
- `index.js` / `src/tui-launcher.js` — `torl` binary; finds/spawns `torl-tui`.
- `bin/torl-cli.js` + `src/cli.js` — headless downloader (`--help`, `--version`, `--output`, `--quiet`, `--json`, `--concurrency`).
- Default output dir: `~/Downloads` (or `%USERPROFILE%\Downloads`), else cwd. Override with `-o`.

### Core download path (`src/`)
- `download.js` — Promise-based download; peer pool + reconnect/backoff; tracker re-announce; global `RarityMap`; DHT fallback; `AbortSignal` graceful shutdown; saves `.torl.state` every 30s.
- `torrent-parser.js` — open/size/infoHash/block length; Buffer coercion from bencode.
- `tracker.js` — UDP + HTTP announce; optional `AbortSignal`.
- `dht.js` — Mainline DHT (BEP 5): bootstrap, iterative `get_peers`.
- `message.js` — peer-wire + BEP 10 extension messages.
- `Pieces.js` / `Queue.js` / `RarityMap.js` — piece state, per-peer queue (rarest-first), global rarity.
- `file-writer.js` — multi-file path layout and writes.
- `state.js` / `verify.js` — pause/resume via `<target>.torl.state` + SHA1 verify on restart.
- `nat.js` — UPnP then NAT-PMP port mapping (`mapPort` / `unmapPort`).

### Magnet path (`src/`)
- `magnet-parser.js` — magnet URIs (hex/base32 info hash, dn, tr).
- `metadata-downloader.js` — BEP 9/10 metadata exchange from a peer.
- `magnet-resolver.js` — trackers + DHT → metadata → full torrent object.

### TUI (`tui/`)
- Go Bubble Tea app; one `torl-cli` child process per torrent.
- Empty dashboard; add via paste/path (`a`) or file picker (`f`); output dir (`o`).
- Pause/resume = SIGTERM to child (CLI saves `.torl.state`); resume respawns `torl-cli`.
- Session queue: `tui/torl/queue.go` persists incomplete items to `$XDG_CONFIG_HOME/torl/queue.json` (via `os.UserConfigDir`); restore as Paused on launch; CLI args still auto-start.
- Needs `torl-cli` on PATH or `--torl-path`.
- Release binaries: `.github/workflows/release-tui.yml` (Linux/macOS/Windows x64+arm64).

### Tests
- `tests/*.test.js` — unit/integration with `node:test`.
- `tests/mocks/` — UDP tracker, TCP peer, DHT node, UPnP, NAT-PMP, metadata peer.
- `tests/fixtures/` — sample torrents / generators.

## Specs and intent (load per task, not always)
- `docs/intent/functional-torl.md` — original phase intent (note: CommonJS constraint is **stale**; project is ESM).
- `docs/specs/interactive-tui.md` — interactive TUI behavior.
- `tasks/todo.md` / `tasks/plan.md` — current/recent task tracking.
- `CHANGELOG.md` — released behavior.

## Patterns
- **Mock integration test**: start mock peer/tracker → call `download(torrent, path, { peers, useDHT: false })` → assert file bytes → `finally` close mocks and `fs.rmSync` tmp dir. See `tests/download.test.js`.
- **Abortable network APIs**: accept optional `AbortSignal` (tracker, download, CLI).
- **Buffer over Uint8Array** at module boundaries after bencode decode.
- **TUI isolation**: Node owns BitTorrent; Go owns UI and process lifecycle only.

## Package
- npm name: `torl-client`. Binaries: `torl`, `torl-cli`, `torl-tui`.
