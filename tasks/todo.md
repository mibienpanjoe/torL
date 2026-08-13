# anacrolix engine migration

## Approved

- [x] Approve `docs/specs/anacrolix-engine.md`.
- [x] Approve a newer Go minimum and `github.com/anacrolix/torrent v1.61.0`; scanner-driven floor finalized at Go 1.25.13.
- [x] Approve upload while downloading, with exit and no seeding after completion.
- [x] Approve `TORL_DOWNLOAD_ENGINE=node` as a temporary one-release rollback.

## Foundation

- [x] Pin dependency, update Go baseline/CI, and add MPL/source notices.
- [x] Define and test the additive engine JSON contract.
- [x] Pass module verification, vulnerability scan, Go tests, and cross-build smoke gate.

## Replacement

- [x] Implement and test the one-torrent Go engine lifecycle.
- [x] Add and test internal `--engine-json` mode.
- [x] Add and test the non-shelling Node engine runner and signal propagation.
- [ ] Prove `.torrent`, magnet, single/multi-file, pause/resume, and corrupt-data behavior locally. (`.torrent` transfer and legacy cases pass; direct Go magnet/resume/corrupt fixtures remain.)

## Cutover

- [x] Teach the TUI to consume real byte rates additively.
- [x] Make anacrolix default with tested Node rollback.
- [ ] Record controlled throughput and cross-platform release evidence.
- [x] Update README, CONTRIBUTING, AGENTS, and CHANGELOG.
- [x] Complete code, security, compatibility, and packaging review. (Controlled throughput evidence remains before release.)

## Deferred removal

- [ ] Measure canary rollback usage.
- [ ] Seek separate approval for Node engine removal and any `.torl.state` retirement.
