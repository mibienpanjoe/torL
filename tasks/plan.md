# Implementation Plan: TUI Pause/Resume and Individual Torrent Control

## Overview

Add pause/resume support to the TUI with per-torrent control. Each torrent runs in its own `torl-cli --json` process so one failure does not affect the others. Users can select a torrent with arrow keys and press `p` to pause or resume it. Quitting the TUI (`q` or `Ctrl+C`) gracefully stops all active downloads and persists progress to existing `.torl.state` files. Re-launching the same torrent automatically resumes from the saved state.

## Architecture Decisions

- **One process per torrent.** The TUI spawns a separate `torl-cli` process for each input. This isolates failures and makes per-torrent pause/resume straightforward.
- **Pause is a graceful stop + save.** Pressing `p` sends a controlled shutdown signal to the selected process. The CLI saves its bitfield state and exits. Resume spawns a fresh process that reads the state file and continues.
- **Resume is implicit.** The CLI already verifies existing files against the info hash and loads `.torl.state` on startup. The TUI does not need new resume logic beyond re-spawning a process for the same input.
- **Cross-platform signal handling.** On Unix, send `SIGTERM`. On Windows, kill the process tree; the CLI state file is written on a best-effort basis. Because Windows lacks reliable graceful signals, the CLI will also periodically save state during download to minimize data loss.
- **Selection model.** The TUI maintains a `cursor` index. Only the selected download responds to `p`. Visual highlighting shows which torrent is selected.
- **State badges.** `Downloading`, `Paused`, `Resuming`, `Complete`, `Error`.

## Task List

### Phase 1: CLI graceful shutdown and periodic state save
- [ ] Task 1: Add SIGTERM/SIGINT handlers to `bin/torl-cli.js` that forward a shutdown request into `download.js`.
- [ ] Task 2: Extend `src/download.js` to accept an abort/shutdown signal, close peer sockets, save the bitfield, and exit cleanly.
- [ ] Task 3: Add periodic state save during download (every 30s or on every completed piece) so Windows and hard kills lose minimal progress.
- [ ] Task 4: Add/update tests for graceful shutdown and periodic state save.

**Checkpoint: Phase 1**
- [ ] `npm test` passes.
- [ ] Running `torl-cli` and sending SIGTERM saves a valid `.torl.state` file.

### Phase 2: TUI process-per-torrent refactor
- [ ] Task 5: Replace single `spawnTorl()` with a `Process` struct per input in `tui/torl/model.go`.
- [ ] Task 6: Spawn one `torl-cli --json -o <dir> <input>` process per input on TUI start.
- [ ] Task 7: Route stdout/stderr and events per process back into the shared `Downloads` map keyed by input.
- [ ] Task 8: Add Go tests for process lifecycle and event routing.

**Checkpoint: Phase 2**
- [ ] `go test ./...` passes.
- [ ] TUI still works for single and multiple torrents.

### Phase 3: Selection and per-torrent pause/resume
- [ ] Task 9: Add `cursor` index and `↑`/`↓` key handling to the TUI model.
- [ ] Task 10: Highlight the selected download in `View()`.
- [ ] Task 11: Implement `p` to pause/resume the selected process: send shutdown signal (pause) or spawn a new process (resume).
- [ ] Task 12: Add `Paused` and `Resuming` status badges.
- [ ] Task 13: Add Go tests for selection and pause/resume.

**Checkpoint: Phase 3**
- [ ] `go test ./...` passes.
- [ ] Manual test: pause one torrent while another keeps downloading.

### Phase 4: Global graceful quit
- [ ] Task 14: On `q` / `Ctrl+C`, send shutdown signals to all active processes and wait for them to exit before the TUI closes.
- [ ] Task 15: Show a brief "Saving progress..." message while shutting down.
- [ ] Task 16: Add Go tests for global shutdown.

**Checkpoint: Phase 4**
- [ ] `go test ./...` passes.
- [ ] Manual test: quit with multiple active downloads and verify `.torl.state` files exist.

### Phase 5: Integration, docs, and release
- [ ] Task 17: Run full `npm test` and `go test ./...`.
- [ ] Task 18: Update README.md with new TUI keybindings.
- [ ] Task 19: Update AGENTS.md to document the one-process-per-torrent design and signal handling.
- [ ] Task 20: Bump version, create GitHub release, publish to npm.

**Checkpoint: Complete**
- [ ] All tests pass.
- [ ] Package published.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Signal handling differs on Windows | High | Periodic state saves every 30s or per completed piece; pause on Windows may lose a small window of progress. |
| Spawning many processes for many torrents | Medium | Cap is implicit via Node/Go resource limits; acceptable for typical use (tens of torrents). |
| Race conditions in TUI event routing | Medium | Use existing mutex; route events by input ID; add targeted tests. |
| Pause during active piece request leaves partial piece | Low | Periodic state save + verification on resume re-checks partially downloaded pieces. |

## Open Questions

- Should `Ctrl+C` always be a graceful pause, or should a second `Ctrl+C` force-kill? (Recommended: first graceful, second force-kill.)
- Should the TUI show a confirmation before quitting if downloads are active? (Recommended: no, just pause and quit.)
- Should paused torrents be automatically resumed when the TUI restarts? (Recommended: yes, via existing CLI resume; no extra TUI action needed.)
