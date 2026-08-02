# Spec: Interactive TUI Workflow

## Objective

Make `torl` a self-contained terminal application for people who want to manage downloads without composing command-line arguments. Running `torl` with no positional inputs opens an empty dashboard; existing `torl <torrent-file|magnet-link>...` usage continues to preload downloads.

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
- `tui/torl/model_test.go` verifies interaction state and validation.
- `tests/` verifies the Node wrapper and downloader.

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
- Add a Node wrapper test proving no arguments are forwarded to the TUI instead of producing usage failure.
- Keep process spawning behind existing commands; unit tests must not start real downloads.
- Run all Go tests and build the TUI before completion; run the Node suite with the repository command.

## Boundaries

- Always: validate manual paths and magnet shape before spawning, preserve positional-argument compatibility, keep keyboard help visible, keep the TUI open until explicit quit.
- Ask first: add dependencies, introduce persistent queue storage, change downloader protocol or state format.
- Never: invoke a native GUI file dialog, execute shell-expanded input, store magnet links outside existing download state, or auto-start an invalid source.

## Success Criteria

- `torl` with no arguments opens the TUI and exits normally only when the user quits.
- The empty state clearly offers `a` for paste/path and `f` for browsing `.torrent` files.
- Pasted magnets and typed torrent paths can be added while the TUI is already running.
- The integrated picker filters for `.torrent` files.
- `o` changes the destination for downloads added afterward.
- Completing or failing all downloads does not close the dashboard automatically.
- Existing preloaded-input, selection, pause/resume, help, and output flags remain compatible.

## Open Questions

None for this MVP. Persistent queue/history is deliberately deferred.
