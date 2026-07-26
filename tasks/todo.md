# torL Phase 2A — Pause and Resume

## Phase 2A.1: State Persistence
- [x] Task 1: Add `src/state.js` to read/write `.torl.state` files
  - Save/load base64-encoded bitfield.
  - Handle missing/corrupt state gracefully.

## Phase 2A.2: Piece Verification
- [x] Task 2: Add `src/verify.js` to hash existing files by piece
  - Support single-file and multi-file torrents.
  - Mark missing/corrupt pieces as incomplete.

## Phase 2A.3: Integrate into Download
- [x] Task 3: Wire state/verify into `src/download.js` and `src/Pieces.js`
  - Load state and verify files before connecting.
  - Initialize `Pieces` with verified bitfield.
  - Save state incrementally on piece completion.
  - Add resume download test.

## Phase 2A.4: CLI and Fixture
- [x] Task 4: Generate resume fixture and update CLI
  - Create `tests/fixtures/resume.torrent` with two pieces.
  - `index.js` transparently resumes via `download()`.

## Checkpoint: Complete
- [x] All 43 tests pass.
- [x] `AGENTS.md` updated.

## Plan

See `tasks/plan.md` for full architecture decisions, acceptance criteria, and risks.
