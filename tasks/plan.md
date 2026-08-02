# Implementation Plan: Interactive TUI Workflow

## Overview

Turn the existing argument-driven progress screen into a long-lived dashboard. The Node wrapper will always launch the TUI, and the Go model will support adding validated sources and changing the output directory at runtime.

## Architecture Decisions

- Keep the current one-process-per-download design; dynamic additions call the existing spawn command.
- Use one text input component for source and output dialogs.
- Use the existing Bubbles file picker for `.torrent` browsing; add no dependency.
- Keep a finite interaction mode so navigation keys cannot leak into dialogs.
- Do not quit when the pending count reaches zero; only `q` or `Ctrl+C` exits the dashboard.

## Task List

### Phase 1: Launchable dashboard

- [x] Make zero positional arguments valid in both launchers.
- [x] Render an actionable empty state and keep the dashboard open after work finishes.
- [x] Cover launch and empty-state behavior with Node and Go tests.

### Checkpoint: Dashboard

- [x] Focused Node and Go tests pass.
- [x] `torl` can enter the TUI without inputs.

### Phase 2: Add downloads

- [x] Add a source dialog accepting pasted magnets and typed `.torrent` paths.
- [x] Validate, normalize, and reject duplicate sources before spawning.
- [x] Add a `.torrent`-filtered integrated file picker.
- [x] Cover dialog, validation, duplicate, and picker behavior with Go tests.

### Checkpoint: Adding

- [x] Each source route produces the same normalized dynamic-add path.
- [x] The existing process-spawn contract remains unchanged.

### Phase 3: Destination and polish

- [x] Add an output-directory dialog for future downloads.
- [ ] Make footer help and modal hints context-specific.
- [ ] Update README and help output.
- [ ] Run all Node/Go tests, Go build, package dry run, and manual TUI smoke check.

### Checkpoint: Complete

- [ ] All specification success criteria are met.
- [ ] Code and UX review have no blocking findings.
- [ ] Changes are saved as small, descriptive commits.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Bubble Tea commands mutate shared process state | Medium | Reuse existing locking and keep new UI transitions inside `Update`. |
| File picker API differs in the pinned Bubbles version | Medium | Inspect the installed module API before implementing and test selection directly. |
| Pasted paths contain quotes or `~` | Medium | Normalize common terminal paste forms without invoking a shell. |
| A completed queue previously caused automatic exit | High | Add regression tests and remove only pending-count quit branches. |

## Open Questions

None. The user approved the recommended MVP and all three source-entry methods.
