<p align="center">
  <img src="assets/logo.png" alt="torL logo" width="160">
</p>

<h1 align="center">torL</h1>

<p align="center">
  A minimal, dependency-light BitTorrent client for Node.js.
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
- **Tracker + DHT peer discovery** — supports UDP and HTTP trackers plus Mainline DHT.
- **Rarest-first piece selection** — prioritizes the pieces that are least available in the swarm.
- **Pause & resume** — a `.torl.state` file stores progress; existing data is verified on restart.
- **NAT traversal** — automatic UPnP IGD and NAT-PMP port mapping helpers.
- **Interactive TUI** — running `torl` opens a dashboard where downloads can be added, monitored, paused, and resumed.
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

The `torl` command opens the TUI; the underlying TUI binary (`torl-tui`) is downloaded automatically during `npm install` for your platform from the matching GitHub release. If a prebuilt binary is not available, it falls back to building from source when Go is installed.

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
- Downloaded progress is saved automatically; re-running the same torrent resumes where it left off.

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

## Development

Run the test suite:

```bash
npm test
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

[MIT](LICENSE)

## Acknowledgements

Built with [bencode](https://github.com/themasch/node-bencode) for torrent decoding and [Bubble Tea](https://github.com/charmbracelet/bubbletea) for the TUI.
