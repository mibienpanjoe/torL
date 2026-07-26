# Implementation Plan: Phase 2A — Pause and Resume

## Overview

Add the ability to pause and resume a torrent download. On exit, the client saves the completion bitfield to disk. On restart, it reads the existing files, verifies completed pieces against their SHA1 hashes, and only downloads the missing pieces.

## Scope

This phase implements **pause/resume only**. Phase 2B (uploading/seeding) is skipped per the user’s request.

## Architecture Decisions

- **State file format.** A JSON file named `<info.name>.torl.state` next to the download target. It stores a base64-encoded bitfield and a version number.
- **Verification on resume.** `src/verify.js` reads the existing files and hashes each piece, comparing against `torrent.info.pieces`.
- **Pieces accepts initial state.** `src/Pieces.js` can be initialized with a pre-completed bitfield so already-verified pieces are not requested again.
- **State is saved incrementally.** `src/download.js` writes the state file each time a piece is fully received, so crashes lose at most one piece.
- **CLI resumes transparently.** `node index.js <torrent-file>` loads the state file if it exists.
- **Test fixture.** A new `tests/fixtures/resume.torrent` with two pieces lets tests verify that a partially completed download skips the first piece and downloads the second.

## Task List

### Phase 2A.1: State persistence
- [x] Task 1: Add `src/state.js` to read/write `.torl.state` files.
  - **Files likely touched:** `src/state.js`, `tests/state.test.js`
  - **Acceptance criteria:**
    - Can save a bitfield and load it back.
    - Missing or malformed state files return an empty bitfield without failing.
  - **Estimated scope:** Small (1–2 files)

### Phase 2A.2: Piece verification
- [x] Task 2: Add `src/verify.js` to hash existing files by piece.
  - **Files likely touched:** `src/verify.js`, `tests/verify.test.js`
  - **Acceptance criteria:**
    - Correctly verifies a complete single-file torrent.
    - Correctly verifies a multi-file torrent.
    - Detects corrupted/missing pieces and marks them as not completed.
  - **Estimated scope:** Medium (2–3 files)

### Checkpoint: State and Verification
- [x] `npm test` passes.
- [x] Unit tests cover state and verify modules.

### Phase 2A.3: Integrate into download
- [x] Task 3: Wire state/verify into `download.js` and `Pieces.js`.
  - **Files likely touched:** `src/download.js`, `src/Pieces.js`, `tests/download.test.js`
  - **Acceptance criteria:**
    - `download()` loads state and verifies existing files before connecting to peers.
    - Already-verified pieces are not requested.
    - State file is updated incrementally as pieces complete.
    - Resume test proves only the missing piece is downloaded.
  - **Estimated scope:** Medium (3–4 files)

### Phase 2A.4: CLI and fixture
- [x] Task 4: Generate resume test fixture and update CLI.
  - **Files likely touched:** `tests/fixtures/resume.torrent`, `tests/fixtures/create-resume-fixture.js`, `index.js`
  - **Acceptance criteria:**
    - New fixture has two pieces of known content.
    - CLI transparently resumes via `download()`.
  - **Estimated scope:** Small (2–3 files)

### Checkpoint: Complete
- [x] All 43 tests pass.
- [x] `AGENTS.md` updated to document pause/resume behavior.
- [x] Code review passes.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| State file corruption leaves download stuck | Medium | Treat malformed state as empty; re-verify all pieces on resume. |
| Verification is slow for large files | Medium | Only verify on resume; incremental completion avoids repeated verification. |
| Multi-file piece boundary mapping is error-prone | High | Add dedicated unit tests for `verify.js` with multi-file torrents. |
| Writing state on every piece could be slow | Low | State file is tiny; can throttle later if needed. |

## Open Questions

- Should the state file be hidden (`.torrent-name.torl.state`) or in a `.torl` directory? (Keep it next to the download for simplicity.)
- Should we keep a backup of the previous state file? (Not for this phase; can add later.)
