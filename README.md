<p align="center">
  <img src="assets/logo.png" alt="torL logo" width="160">
</p>

<h1 align="center">torL</h1>

<p align="center">
  A fast BitTorrent client with a Node.js CLI and an anacrolix-powered Go engine.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/node-%3E%3D20.0.0-339933?logo=node.js&logoColor=white" alt="Node.js >= 20">
  <img src="https://img.shields.io/badge/license-MIT-7D56F4" alt="MIT License">
  <img src="https://img.shields.io/badge/ESM-only-04B575" alt="ESM only">
</p>

<p align="center">
  <img src="assets/tui-preview.png" alt="torL TUI preview" width="720">
</p>

## Features

- **Torrent files & magnet links** — download from `.torrent` files or resolve `magnet:` links.
- **Mature BitTorrent engine** — anacrolix provides TCP/uTP peers, trackers, DHT, PEX, inbound connections, end-game behavior, and piece verification.
- **Bandwidth utilization** — concurrent peer requests and upload reciprocity keep healthy swarms productive without seeding after completion.
- **Pause & resume** — partial files are checked and resumed; legacy `.torl.state` files are retained during migration.
- **NAT traversal** — automatic port mapping is enabled where the network supports it.
- **Interactive TUI** — running `torl` opens a dashboard where downloads can be added, monitored, paused, and resumed; incomplete items are restored as paused on the next launch.
- **Multiple downloads** — queue or run several torrents and magnet links concurrently.
- **Fully tested** — fast, deterministic mock tests for the peer wire protocol, trackers, DHT, and NAT.

## Installation

Install or update to the latest published version from npm:

```bash
npm install --global torl-client@latest
```

Check the installed version with `torl-cli --version`.

Or clone and install locally:

```bash
git clone https://github.com/mibienpanjoe/torL.git
cd torL
npm install
```

The `torl` command opens the TUI; the underlying TUI and download-engine binary (`torl-tui`) is downloaded automatically during `npm install` for your platform from the matching GitHub release. If a prebuilt binary is not available, building from source requires Go 1.25.13 or newer.

## TUI Usage

Running `torl` without arguments opens the interactive dashboard:

```bash
torl
```

From there, paste a magnet link, type a `.torrent` path, or browse for a torrent file. Positional inputs remain available as a faster way to preload one or more downloads:

```bash
# preload a single torrent
torl debian-13.6.0-amd64-netinst.iso.torrent

# preload several inputs
torl a.torrent b.torrent "magnet:?xt=urn:btih:..."

# override the output directory
torl file.torrent -o ~/Downloads

# override the path to the downloader backend
torl file.torrent -torl-path ./bin/torl-cli.js
```

Inside the TUI:

- `a` opens a field for pasting a magnet link or entering a `.torrent` path.
- `f` opens the integrated `.torrent` file picker.
- `o` changes the output directory for downloads added afterward.
- `↑` / `↓` select a torrent.
- `p` toggles pause/resume for the selected torrent.
- `q` or `Ctrl+C` pauses all active downloads and exits.
- `Esc` closes the active input or picker without changing anything.
- Incomplete downloads are remembered in the TUI queue (`~/.config/torl/queue.json` on Linux; the platform user config dir elsewhere) and reappear as **Paused** next launch — press `p` to resume.
- Partial files remain in the output directory and are verified when the download resumes. Older `.torl.state` files are left untouched for rollback compatibility.

## CLI Usage

For scripts or headless environments, use `torl-cli` instead of the TUI.

```bash
torl-cli <torrent-file|magnet-link>... [options]
```

### Options

```
  -o, --output <dir>       Output directory (default: Downloads)
  -c, --concurrency <n>    Max simultaneous downloads (default: 1)
  -q, --quiet              Suppress progress output
  -h, --help               Show help
  -v, --version            Show version
```

### Examples

Download a single torrent:

```bash
torl-cli debian-13.6.0-amd64-netinst.iso.torrent
```

Download from a magnet link:

```bash
torl-cli "magnet:?xt=urn:btih:...&dn=example"
```

Download multiple torrents concurrently:

```bash
torl-cli a.torrent b.torrent "magnet:?xt=urn:btih:..." -c 3
```

Output is written to a directory named after the torrent inside the output directory.

### Download engine

Starting with v1.4.0, `torl-cli` delegates each torrent to the bundled
`torl-tui` binary's headless anacrolix engine. The public commands and flags do
not change: Node.js continues to coordinate multiple inputs while Go handles
peer discovery, piece scheduling, verification, disk I/O, inbound peers, and
upload reciprocity.

Progress is measured from useful payload bytes and sampled once per second.
The JSON stream keeps its existing fields and additively reports `uploaded`,
`downloadRate`, and `uploadRate`. torL uploads while a download is active but
exits when it completes; it does not remain running as a seeder.

During the v1.4.0 canary release only, set `TORL_DOWNLOAD_ENGINE=node` to use
the previous downloader if the new engine causes a compatibility problem:

```bash
TORL_DOWNLOAD_ENGINE=node torl-cli file.torrent
```

This rollback switch is temporary. It does not delete partial files or legacy
`.torl.state` files.

## Development

Run the test suite:

```bash
npm test
```

Run the Go engine and TUI tests (Go 1.25.13+):

```bash
cd tui
go test ./...
```

Run a single test file:

```bash
npm test -- tests/download.test.js
```

Build the TUI binary from source:

```bash
npm run build-tui
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, conventions, and how to submit changes.

## License

[MIT](LICENSE). Distributed binaries also contain third-party components; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Acknowledgements

Built with [anacrolix/torrent](https://github.com/anacrolix/torrent) for the BitTorrent engine, [bencode](https://github.com/themasch/node-bencode) for the temporary Node rollback engine, and [Bubble Tea](https://github.com/charmbracelet/bubbletea) for the TUI.
