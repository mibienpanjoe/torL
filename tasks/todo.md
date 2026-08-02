# Interactive TUI Workflow

## Task 1: Launchable empty dashboard

- [x] `torl` forwards zero inputs to the TUI.
- [x] The Go launcher accepts zero inputs.
- [x] Empty state lists the available add actions.
- [x] Dashboard stays open when the queue is empty or finishes.
- Verify: focused Node test, `go test ./torl`, `go build ./...`.

## Task 2: Dynamic source input

- [x] `a` opens a focused source field.
- [x] Paste/type accepts a magnet or `.torrent` path.
- [x] Invalid and duplicate sources show an inline error.
- [x] A valid source is appended and spawned.
- Verify: `go test ./torl`.

## Task 3: Integrated torrent picker

- [x] `f` opens a file picker at the current directory.
- [x] Only directories and `.torrent` files are selectable.
- [x] Selection follows the same validation/add path.
- Verify: `go test ./torl` and manual picker smoke check.

## Task 4: Output selection and UX polish

- [x] `o` edits the output directory for future additions.
- [x] Empty, dashboard, dialog, and picker states have contextual help.
- [x] README and command help describe no-argument usage and keys.
- Verify: all Node/Go tests, Go build, package dry run, manual smoke check.

## Not Doing

- Persistent queue or download history.
- Native graphical file dialogs.
- Removing or replacing `torl-cli`.
- Changing torrent/network behavior.
