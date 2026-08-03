# Persistent TUI queue

## Done

- [x] `tui/torl/queue.go` load/save at user config path with 0600 perms.
- [x] Restore incomplete items as Paused on launch (no auto-spawn).
- [x] Persist on add/pause/resume/complete/error/quit; drop completed.
- [x] Per-download output; resume respawns `torl-cli` (fixes prior resume bug).
- [x] CLI positional inputs still auto-start and override restored paused.
- [x] Go tests for queue + model integration; docs/spec/README/AGENTS updated.

## Not Doing

- Auto-resume on launch.
- Completed download history / dismiss key.
- Changing `.torl.state` or Node download protocol.
- Native graphical file dialogs.
