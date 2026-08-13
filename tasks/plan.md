# Implementation Plan: anacrolix Download Engine

## Overview

Migrate the BitTorrent data plane to `github.com/anacrolix/torrent v1.61.0` behind torL's existing CLI/JSON adapter. Introduce and prove the replacement before changing the default, retain the Node engine as a temporary rollback, and defer destructive removal to a separately approved major release.

Specification: `docs/specs/anacrolix-engine.md`.

## Architecture decisions

- Preserve `torl` and `torl-cli`; use the prebuilt `torl-tui` binary's internal engine mode rather than shipping another daemon or asset.
- Pin upstream v1.61.0 and raise the Go floor to 1.24 because supported upstream releases require it.
- Keep anacrolix types behind a torL-owned `tui/engine` API and preserve the JSON-lines contract additively.
- Let anacrolix own peers, piece selection, hashing, upload reciprocity, DHT/PEX/uTP, disk I/O, and resume checking.
- Keep Node orchestration for multi-input concurrency and TUI process compatibility during the first cutover.
- Retain a temporary environment-selected Node rollback; removal is out of scope for this release.

## Task list

### Phase 1: Dependency and contract foundation

- [x] Task 1: Pin the supported engine and Go baseline.
  - Acceptance: `tui/go.mod` pins v1.61.0; Go minimum and CI are 1.24; notices and source-availability requirements are documented; no binary is committed.
  - Verify: `cd tui && go mod tidy && go mod verify && go test ./...`; inspect release matrix and dependency diff.
  - Dependencies: specification approval.
  - Files: `tui/go.mod`, `tui/go.sum`, `.github/workflows/release-tui.yml`, `AGENTS.md`, `CONTRIBUTING.md`.

- [x] Task 2: Define the engine configuration and JSON event contract.
  - Acceptance: typed torL-owned config/events cover start, byte-level progress, complete, error, peer gauges, upload/download rates, and cancellation; JSON remains backward compatible.
  - Verify: `cd tui && go test ./engine -run 'Event|Config'`.
  - Dependencies: Task 1.
  - Files: `tui/engine/event.go`, `tui/engine/config.go`, `tui/engine/event_test.go`.

### Checkpoint: Foundation

- [x] Dependency version, Go floor, MPL obligations, and transitive footprint reviewed.
- [x] `go mod verify`, Go tests, cross-build smoke tests, and `govulncheck ./...` pass.
- [x] JSON fixtures are accepted by the existing TUI parser.

### Phase 2: Working replacement behind the adapter

- [x] Task 3: Implement one-torrent anacrolix lifecycle.
  - Acceptance: magnet and `.torrent` inputs use upstream defaults, download to the compatible path, upload while active, verify data, emit progress each second, and close on context cancellation.
  - Verify: engine unit tests plus deterministic local `.torrent` integration test.
  - Dependencies: Task 2.
  - Files: `tui/engine/engine.go`, `tui/engine/source.go`, `tui/engine/progress.go`, `tui/engine/engine_test.go`.

- [x] Task 4: Add internal headless mode to the existing Go binary.
  - Acceptance: normal invocation still opens the TUI; `--engine-json` runs one source; stdout is JSON-only; stderr contains sanitized diagnostics; SIGINT/SIGTERM cancel cleanly.
  - Verify: `cd tui && go test . ./engine` and a subprocess cancellation integration test.
  - Dependencies: Task 3.
  - Files: `tui/main.go`, `tui/engine/command.go`, `tui/engine/command_test.go`.

- [x] Task 5: Add the Node engine runner and preserve rollback compatibility.
  - Acceptance: Node locates the matching Go binary, passes source/output/id without a shell, relays JSON/text modes, and forwards abort to the child; existing Node downloader remains default.
  - Verify: `npm test -- tests/engine-runner.test.js tests/cli.test.js tests/tui-launcher.test.js`.
  - Dependencies: Task 4.
  - Files: `src/engine-runner.js`, `src/cli.js`, `tests/engine-runner.test.js`, `tests/cli.test.js`.

### Checkpoint: Replacement

- [ ] Existing Node engine and new Go engine both pass single/multi-file, magnet, pause, resume, and corrupt-data tests.
- [ ] Existing CLI help/version/flags, output layout, and TUI queue remain unchanged.
- [ ] No live network is required for correctness tests.

### Phase 3: Canary and default cutover

- [x] Task 6: Consume real engine rates in the TUI.
  - Acceptance: optional rate/upload fields parse safely; new TUI uses engine-provided rate; old event fixtures still work.
  - Verify: `cd tui && go test ./torl -run 'Event|Progress|Speed'`.
  - Dependencies: Task 5.
  - Files: `tui/torl/event.go`, `tui/torl/model.go`, `tui/torl/model_test.go`.

- [x] Task 7: Switch the default with a bounded rollback.
  - Acceptance: anacrolix is default; `TORL_DOWNLOAD_ENGINE=node` restores the old engine; success, error, and signal exit semantics match; rollback is covered by tests.
  - Verify: full Node/Go tests and deterministic end-to-end downloads through `torl-cli` and the TUI process path.
  - Dependencies: Task 6.
  - Files: `src/cli.js`, `bin/torl-cli.js`, `tests/cli.test.js`, `tests/magnet-e2e.test.js`.

- [ ] Task 8: Add performance and release evidence.
  - Acceptance: wrapper reaches at least 90% of direct anacrolix throughput on the controlled fixture; no size-dependent scheduler collapse; six release targets build; artifact size and notices are recorded.
  - Verify: benchmark command, `go test -race ./...`, `go vet ./...`, `govulncheck ./...`, `npm test`, `npm pack --dry-run`, and release-matrix dry run.
  - Dependencies: Task 7.
  - Files: `tui/engine/benchmark_test.go`, `docs/benchmarks/anacrolix-engine.md`, `.github/workflows/release-tui.yml`.

- [x] Task 9: Document the cutover and migration behavior.
  - Acceptance: README, contributor guide, project map, and changelog describe the Go engine, Go 1.25.13 source-build requirement, active-upload policy, resume behavior, and unchanged commands.
  - Verify: documentation links/commands checked against built artifacts; `rg` finds no claim that the Node code is still the default engine.
  - Dependencies: Task 8.
  - Files: `README.md`, `CONTRIBUTING.md`, `AGENTS.md`, `CHANGELOG.md`.

### Checkpoint: Canary release candidate

- [ ] All specification success criteria pass.
- [ ] Dependency, license, security, binary-size, performance, and cross-platform evidence is recorded.
- [ ] Code review has no blocking correctness, security, performance, or compatibility findings.
- [ ] Node rollback is tested but not presented as a permanent supported architecture.

### Later major release, separately approved

- [ ] Measure rollback usage and production failures through the canary window.
- [ ] Decide whether to integrate one shared anacrolix client directly into the Go TUI.
- [ ] Remove Node peer/tracker/piece/download code and fallback tests only after zero required rollback usage is demonstrated.
- [ ] Remove legacy `.torl.state` handling only with an explicit migration policy; never delete user state automatically.

## Risks and mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Go baseline rises from 1.22 to 1.25.13 | Medium | Update CI/docs together; keep prebuilt binaries as the normal npm path; pin the patched toolchain used for releases. |
| Large transitive graph and binary | High | Pin version; audit vulnerabilities/licenses; measure every release artifact; keep CGO disabled. |
| MPL-2.0 distribution obligations | High | Ship notices and a source-availability statement; verify release packaging before cutover. |
| Output or resume semantics differ | High | Contract tests against existing fixtures and temp dirs; retain files/state and Node rollback. |
| Signal is lost through TUI -> Node -> Go | High | Subprocess cancellation tests and explicit signal forwarding at each boundary. |
| Multiple engine processes compete for a port | Medium | Configure ephemeral listen ports and test `--concurrency > 1`. |
| Upstream API drift | Medium | Pin v1.61.0; isolate types in `tui/engine`; upgrade only through a reviewed dependency task. |
| Performance claim is swarm-dependent | Medium | Require controlled local baseline plus separately reported public-swarm evidence. |

## Approved decisions

- A newer Go baseline, active upload without post-completion seeding, and the one-release Node rollback were approved on 2026-08-13. The vulnerability gate finalized the exact Go floor at 1.25.13.
