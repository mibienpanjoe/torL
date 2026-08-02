# Changelog

All notable changes to torL are documented in this file.

## [Unreleased]

### Added

- Open `torl` as an interactive dashboard without requiring a torrent or magnet argument.
- Add downloads from inside the TUI by pasting a magnet, entering a `.torrent` path, or browsing with the integrated file picker.
- Change the output directory for downloads added later in the same TUI session.

### Changed

- Keep the dashboard open after all downloads complete or fail, so more items can be added without restarting torL.
- Make `npm run build-tui` always compile the checked-out Go sources instead of reusing a stale binary.

## [1.2.0] - 2026-08-02

### Changed

- Pipeline up to 16 block requests per peer to keep connections busy on latent networks.
- Reuse open output file descriptors and save resume state periodically instead of after every piece.
- Start downloads from the first successful tracker or DHT source and reuse peers found during magnet resolution.
- Cache rarest-first ordering until peer availability changes.

### Fixed

- Release and reassign outstanding blocks when a peer chokes, disconnects, or stops responding.
- Interoperate with peers that advertise a different BEP 9 metadata extension ID.
- Set the BEP 10 extension bit in the correct handshake byte.
- Bound and cancel magnet metadata attempts and validate malformed UDP tracker responses.

### Performance

- Increased the local 8 MiB latency benchmark to 4.88 MiB/s with 25 ms response latency per block.
- Reduced tracker-first startup from about 3.06 seconds to about 50 milliseconds in the deterministic integration test.
- Reduced 160 rarest-first selections across 10,000 pieces from 54.7 milliseconds to 12.9 milliseconds.
