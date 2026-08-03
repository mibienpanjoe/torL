# Spec: Interactive TUI Workflow

## Objective

Make `torl` a self-contained terminal application for people who want to manage downloads without composing command-line arguments. Running `torl` with no positional inputs opens a dashboard (empty or restored from the last session); existing `torl <torrent-file|magnet-link>...` usage continues to preload downloads and starts them immediately.

The first useful action should take at most two keystrokes plus the source itself: `a` then paste/type, or `f` then choose a `.torrent` file.

## Tech Stack

- Node.js ESM wrapper in `index.js`.
- Go 1.22 TUI using the existing Bubble Tea, Bubbles, and Lip Gloss dependencies.
- One `torl-cli --json` child process per download.

## Commands

- Node tests: `source /home/mj/.nvm/nvm.sh && nvm use 24 >/dev/null && npm test`
- Focused Go tests: `cd tui && go test ./torl`
- Full Go tests: `cd tui && go test ./...`
- Go build: `cd tui && go build ./...`
- TUI build: `npm run build-tui`

## Project Structure

- `index.js` launches the platform TUI binary.
- `tui/main.go` parses startup options and starts Bubble Tea.
- `tui/torl/model.go` owns dashboard, dialog, picker, and download state.
- `tui/torl/queue.go` persists incomplete downloads across sessions.
- `tui/torl/model_test.go` / `queue_test.go` verify interaction state, validation, and queue I/O.
- `tests/` verifies the Node wrapper and downloader.

## Persistent queue

- Path: `filepath.Join(os.UserConfigDir(), "torl", "queue.json")` (Linux: `~/.config/torl/queue.json`).
- Schema version 1: `{ "version": 1, "items": [{ "source", "output", "status" }] }`.
- File mode `0600`; directory mode `0700`. Atomic write via temp file + rename.
- On launch: load items as **Paused** (do not spawn). Positional CLI inputs merge in and **start** (CLI wins on duplicate source).
- On add / pause / resume / complete / error / quit: rewrite queue. Drop completed items. Incomplete (including errors) are stored with `status: "paused"`.
- Per-download `output` is stored so resume uses the original destination after `o` changes the default.
- Byte resume remains the existing CLI `.torl.state` + verify path; the queue only restores the TUI list.

## Code Style

Use small Go methods that return commands explicitly and keep input modes finite:

```go
func (m *Model) openSourceInput() tea.Cmd {
	m.mode = sourceInputMode
	m.inputValue = ""
	m.inputCursor = 0
	return nil
}
```

Run `gofmt` on Go changes. Preserve ESM imports and existing Node.js conventions.

## Testing Strategy

- Unit-test empty-dashboard rendering, dialog transitions, source validation, duplicate rejection, output changes, and file selection.
- Unit-test queue load/save, corrupt/missing files, restore-as-paused, resume spawn command, complete drops queue entry, quit persists.
- Add a Node wrapper test proving no arguments are forwarded to the TUI instead of producing usage failure.
- Keep process spawning behind existing commands; unit tests must not start real downloads.
- Run all Go tests and build the TUI before completion; run the Node suite with the repository command.

## Boundaries

- Always: validate manual paths and magnet shape before spawning, preserve positional-argument compatibility, keep keyboard help visible, keep the TUI open until explicit quit, restore incomplete queue items as paused.
- Ask first: add dependencies, change queue schema incompatibly, change downloader protocol or `.torl.state` format.
- Never: invoke a native GUI file dialog, execute shell-expanded input, auto-start restored queue items, or auto-start an invalid source.
- Magnets/paths in the user queue file are intentional session state (restricted file permissions).

## Success Criteria

- `torl` with no arguments opens the TUI and exits normally only when the user quits.
- The empty state clearly offers `a` for paste/path and `f` for browsing `.torrent` files when there is no restored queue.
- Pasted magnets and typed torrent paths can be added while the TUI is already running.
- The integrated picker filters for `.torrent` files.
- `o` changes the destination for downloads added afterward.
- Completing or failing all downloads does not close the dashboard automatically.
- Incomplete downloads reappear as Paused after quit/relaunch; `p` respawns `torl-cli` with the stored output dir.
- Existing preloaded-input, selection, pause/resume, help, and output flags remain compatible.

## Open Questions

None for this slice. Completed-history UI and auto-resume-on-launch remain out of scope.
