# torL Phase 4 — NAT Traversal

## Phase 4.1: UPnP IGD
- [x] Task 1: SSDP discovery and SOAP AddPortMapping
  - Implement SSDP M-SEARCH discovery.
  - Parse IGD description XML for control URL.
  - Send SOAP AddPortMapping / DeletePortMapping.
  - Add mock UPnP gateway and tests.

## Checkpoint: UPnP
- [x] `npm test` passes.
- [x] UPnP tests pass.

## Phase 4.2: NAT-PMP
- [x] Task 2: NAT-PMP port mapping
  - Implement NAT-PMP map request/response.
  - Add mock NAT-PMP gateway and tests.

## Checkpoint: NAT-PMP
- [x] `npm test` passes.
- [x] NAT-PMP tests pass.

## Phase 4.3: Public API and Cleanup
- [x] Task 3: Unified `mapPort` / `unmapPort` and docs
  - `mapPort` tries UPnP then NAT-PMP.
  - `unmapPort` cleans up via the same protocol.
  - Update `AGENTS.md`.

## Checkpoint: Complete
- [x] All tests pass.
- [x] `AGENTS.md` updated.

## Magnet Link Support

- [x] Magnet link parser (`src/magnet-parser.js`)
- [x] BEP 10 extension protocol messages (`src/message.js`)
- [x] BEP 9 metadata downloader (`src/metadata-downloader.js`)
- [x] Magnet resolver with tracker/DHT peer discovery (`src/magnet-resolver.js`)
- [x] CLI accepts magnet links (`index.js`)
- [x] End-to-end magnet link download test
- [x] All tests pass.

## TUI (Go + Bubble Tea)

- [x] Add progress callbacks and `--json` flag to torl CLI.
- [x] Create Go module in `tui/`.
- [x] Implement Bubble Tea model with progress bar and peer list.
- [x] Parse torl JSON events in Go.
- [x] Add Go unit tests for event parsing and model.
- [x] Build `torl-tui` binary and verify it starts.
- [x] Support multiple torrents/magnet links in the TUI.
- [x] Update `AGENTS.md` and `.gitignore`.

## Multi-Torrent CLI

- [x] Accept multiple `.torrent` files and `magnet:` links as positional arguments.
- [x] Add `--concurrency` / `-c` flag to control simultaneous downloads.
- [x] Add `MultiProgressLogger` for per-download progress lines in CLI mode.
- [x] Include `id` in JSON progress events so multi-download consumers can distinguish torrents.
- [x] Add `downloadAll` helper and unit tests for sequential/concurrent/failure handling.
- [x] Update `AGENTS.md`.
- [x] All tests pass.

## Release / Publishing

- [x] Add repository URL, homepage, and bug tracker to `package.json`.
- [x] Update `scripts/install-tui.js` to download prebuilt TUI binaries from GitHub releases with a Go build fallback.
- [x] Update `bin/torl-tui.js` to locate the binary on Windows (`torl-tui.exe`).
- [x] Add `.github/workflows/release-tui.yml` to build and upload TUI binaries for Linux, macOS, and Windows (x64 and arm64) on release.
- [x] Add tests for install-script helpers and the download fallback.
- [x] Verify `npm install` works with and without Go, and `npm publish` succeeds.
- [x] Publish `torl-client@1.0.0` to npm (renamed from `torl` because npm rejected the original name as too similar to existing packages).

## v1.0.1

- [x] Make `torl` launch the TUI and `torl-cli` the headless downloader.
- [x] Default output directory to `~/Downloads` / `%USERPROFILE%\Downloads`.
- [x] Update README and AGENTS.md.
- [x] Publish `torl-client@1.0.1` to npm.

## v1.0.2

- [x] Add 15s timeout to tracker requests and make tracker failures non-fatal.
- [x] Support `announce-list` fallback so dead trackers do not crash downloads.
- [x] Add tracker fallback test.
- [x] Publish `torl-client@1.0.2` to npm.

## v1.0.3 / v1.0.4

- [x] Show real-time download speed in the TUI.
- [x] Fix accidental inclusion of `tui/tui/` build artifact in npm package.
- [x] Publish `torl-client@1.0.4` to npm.

## Plan

- `tasks/plan.md` documents Phase 4 (NAT traversal).
- Magnet link support, the Go TUI, and multi-torrent CLI were added incrementally without separate plan files.
