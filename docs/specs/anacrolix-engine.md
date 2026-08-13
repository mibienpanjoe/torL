# Spec: anacrolix Download Engine Migration

## Assumptions for review

1. `torl` and `torl-cli` remain the public commands; users do not install a second package or daemon.
2. Existing CLI flags, output layout, JSON event names, TUI queue files, and pause/resume behavior remain compatible.
3. Uploading while a download is active is allowed because BitTorrent reciprocity is required for good throughput; torL still stops when the download completes and does not become a long-running seed.
4. Raising the optional Go build requirement was approved. Security scanning subsequently established Go 1.25.13 as the safe release floor. Node.js remains required for the npm command wrappers in this migration.
5. The first cutover keeps the Node downloader as a temporary, opt-in rollback implementation. It is removed only in a later, explicitly approved major release.

## Objective

Replace torL's hand-written Node.js BitTorrent data plane with `github.com/anacrolix/torrent` while preserving the current command and TUI experience. The migration should remove torL's scheduler, peer-discovery, upload, end-game, and synchronous-disk bottlenecks without asking users to learn a new interface.

Success means that torL starts from `.torrent` files and magnet links, downloads and verifies data, uploads while downloading, accepts inbound peers when networking permits, reports stable byte-level progress, pauses cleanly, resumes existing files, and ships as the same npm package with matching prebuilt binaries.

## Tech stack and audited dependency

- Node.js 24 LTS-compatible ESM wrappers for `torl` and `torl-cli`.
- Go 1.25.13 minimum for release and source builds; development may use newer patched Go releases.
- `github.com/anacrolix/torrent v1.61.0`, pinned in `tui/go.mod` and `tui/go.sum`.
- Existing Bubble Tea TUI and JSON-lines process boundary.

Audit findings:

- v1.61.0 is the selected stable release and originally requires Go 1.24. The current reachable `golang.org/x/net` fixes require x/net v0.55.0 and Go 1.25, while the scanned standard-library findings require Go 1.25.13; therefore torL's safe floor is 1.25.13.
- Upstream supports its two most recent minor releases; master is not guaranteed stable.
- The module is MPL-2.0 and has a large transitive dependency graph. The compiled binary, license notices, source-availability statement, binary size, cross-compilation, and vulnerability scan are release gates.
- The upstream default client supports TCP, uTP, DHT, PEX, incoming connections, port forwarding, piece hashing, upload reciprocity, and configurable peer limits. torL should begin with upstream defaults and change tuning only after measurement.

Authoritative sources:

- Package and API: https://pkg.go.dev/github.com/anacrolix/torrent
- v1.61.0 module requirements: https://raw.githubusercontent.com/anacrolix/torrent/v1.61.0/go.mod
- Client defaults: https://raw.githubusercontent.com/anacrolix/torrent/v1.61.0/config.go
- Security policy: https://github.com/anacrolix/torrent/security
- License: https://raw.githubusercontent.com/anacrolix/torrent/v1.61.0/LICENSE

## Architecture

### Migration shape

Use an adapter/strangler migration:

```text
torl TUI
   -> torl-cli --json                 existing public/process contract
      -> torl-tui --engine-json ...  internal Go engine mode
         -> anacrolix/torrent v1.61.0
```

The already-distributed `torl-tui` binary becomes a multi-mode binary. Normal invocation opens the dashboard; the internal `--engine-json` mode runs exactly one torrent and emits JSON lines. This avoids adding a second release asset or runtime daemon.

During the canary period, `TORL_DOWNLOAD_ENGINE=node` selects the old implementation. Absence of the variable selects `anacrolix` after the cutover task. The fallback is intentionally undocumented as a permanent public API and is removed only after release evidence and separate approval.

The TUI continues to spawn `torl-cli` during the first migration. A shared in-process Go session for multiple TUI downloads is a later optimization, not required for the first safe cutover.

### Engine session

- Create one anacrolix client per internal engine process using `torrent.NewDefaultClientConfig()`.
- Set `DataDir` to the requested output directory so existing `<output>/<torrent-name>` layout is preserved.
- Use an ephemeral listen port to prevent collisions between concurrent torL processes while retaining inbound TCP/uTP support.
- Keep DHT, trackers, PEX, TCP, uTP, upload reciprocity, piece verification, and default port forwarding enabled.
- Keep `Seed` false: upload while downloading, exit after completion.
- Add magnets with `AddMagnet`; add files with `AddTorrentFromFile`; wait for `GotInfo`, call `DownloadAll`, and wait for `Complete` or context cancellation.
- Close the client on SIGINT/SIGTERM. Existing partial data remains resumable through anacrolix's file checking. Do not delete legacy `.torl.state` files during the compatibility window.

### Public compatibility contract

The following remain unchanged:

- Binaries: `torl`, `torl-cli`, `torl-tui`.
- Inputs: local `.torrent` paths and magnet URIs.
- Flags: `--output`, `--concurrency`, `--quiet`, `--json`, `--help`, and `--version`.
- `--concurrency` continues to mean simultaneous torrents.
- Output root: `<output>/<torrent-name>`.
- Successful pause caused by SIGTERM exits without being reported as an error.
- TUI queue schema version 1 and restore-as-paused behavior.

The JSON-lines contract remains additive:

```json
{"type":"start","id":"<source>","name":"example","total":1048576,"totalPieces":64}
{"type":"progress","id":"<source>","downloaded":524288,"uploaded":65536,"downloadRate":4194304,"uploadRate":262144,"total":1048576,"percent":0.5,"completedPieces":32,"totalPieces":64,"activePeers":12,"availablePeers":80}
{"type":"complete","id":"<source>","path":"/output/example"}
{"type":"error","id":"<source>","message":"bounded user-safe message"}
```

- Existing fields keep their names and meaning.
- New numeric fields are optional so older TUI binaries can ignore them.
- Progress is sampled once per second from real useful-byte counters, not inferred from completed pieces.
- Diagnostic logs go to stderr; stdout contains JSON only in `--json` mode.
- External library errors are treated as untrusted input and sanitized before terminal display.

## Commands

- Node tests: `source /home/mj/.nvm/nvm.sh && nvm use 24 >/dev/null && npm test`
- Focused Go tests: `cd tui && go test ./engine ./torl`
- Full Go tests: `cd tui && go test ./...`
- Go race tests: `cd tui && go test -race ./...`
- Go vet: `cd tui && go vet ./...`
- Go build: `cd tui && go build -o torl-tui .`
- Cross-build gate: run the release matrix in `.github/workflows/release-tui.yml` with `CGO_ENABLED=0`.
- Dependency audit: `cd tui && govulncheck ./...` using the approved Go toolchain.
- Package check: `npm pack --dry-run` and verify no built binary is committed.

## Project structure

- `tui/engine/`: anacrolix adapter, lifecycle, progress sampling, event types, and tests.
- `tui/main.go`: dispatches normal TUI mode versus internal engine mode.
- `src/engine-runner.js`: locates/spawns the Go binary, relays output, and propagates cancellation.
- `src/cli.js`: retains public parsing, concurrency, text/JSON presentation, and selects the engine adapter.
- `tui/torl/event.go`: additive JSON fields consumed by the dashboard.
- `tests/`: Node contract and fake-process tests.
- `tests/performance/` or `tui/engine` benchmarks: deterministic throughput and sampling checks.

## Code style

Go engine boundaries use contexts and typed events:

```go
type Event struct {
	Type         string  `json:"type"`
	ID           string  `json:"id"`
	Downloaded   int64   `json:"downloaded,omitempty"`
	DownloadRate float64 `json:"downloadRate,omitempty"`
}

func Run(ctx context.Context, cfg Config, emit func(Event) error) error
```

- Keep anacrolix types inside `tui/engine`; the TUI and Node adapter depend only on torL-owned contracts.
- Do not expose upstream experimental APIs as torL public flags.
- Use `gofmt`; preserve ESM conventions and explicit `.js` imports in Node files.

## Testing strategy

- Unit-test event encoding, source validation, output-path calculation, error sanitization, and cancellation.
- Use dependency injection for Node child-process tests; never require live peers for CI correctness.
- Add a deterministic local integration test with an in-process seeder and isolated temporary directories.
- Verify magnet metadata, `.torrent`, single-file, multi-file, pause, resume, corrupt-piece rejection, and completion.
- Keep public-network testing optional and separate.
- Compare the wrapper with a direct anacrolix baseline on the same 512 MiB local fixture. The wrapper must sustain at least 90% of the direct baseline after warm-up and must not show the old size-dependent scheduler collapse.
- Compare a well-seeded public Linux ISO against a mature reference client on the same machine/network before release; record useful payload rate, active peers, time to first byte, and completion time.

## Boundaries

- Always: pin the module version, preserve the public contract, sanitize errors, propagate cancellation, verify downloaded pieces, run Node and Go gates, and retain rollback until cutover evidence exists.
- Ask first: remove the Node fallback, change public flags, change queue schema, enable post-completion seeding, add rate-limit flags, or alter release asset names.
- Never: silently disable upload/DHT/PEX/uTP, execute sources through a shell, delete partial user data or `.torl.state`, use live peers as the CI correctness gate, commit binaries, or track upstream master.

## Success criteria

- All existing Node and Go tests remain green, with new contract and engine integration tests.
- `torl-cli` retains its help/version/flags and downloads both `.torrent` and magnet inputs through anacrolix by default.
- TUI pause/resume and persisted queue behavior remain compatible.
- Progress uses real byte counters at a stable one-second cadence and no longer drops merely because a peer event occurred.
- Active downloads upload and accept inbound peers when networking permits; the process exits at completion.
- Existing partial files resume without data loss; legacy state files are left untouched.
- Linux, macOS, and Windows x64/arm64 binaries build with `CGO_ENABLED=0`.
- Dependency vulnerability, license, binary-size, package, and controlled-throughput gates pass.
- The Node implementation remains available only as rollback for the canary release and has a documented later removal decision.

## Approved decisions

Approved on 2026-08-13:

1. A newer Go floor was approved; the implemented security floor is Go 1.25.13 based on `govulncheck` remediation evidence.
2. Upload is enabled while downloading, with no seeding after completion.
3. `TORL_DOWNLOAD_ENGINE=node` remains as a temporary rollback switch for one canary release.
