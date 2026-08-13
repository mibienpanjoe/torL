# Contributing to torL

Thanks for your interest in contributing! This document covers how to set up the project, run tests, and submit changes.

## Table of Contents

- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Running Tests](#running-tests)
- [Code Style](#code-style)
- [Adding Tests](#adding-tests)
- [Submitting Changes](#submitting-changes)
- [TUI Development](#tui-development)

## Development Setup

### Requirements

- [Node.js](https://nodejs.org/) >= 20.0.0
- [Go](https://go.dev/) >= 1.25.13 (required to build the TUI and download engine)

### Install Dependencies

```bash
npm install
```

This also attempts to build the optional `torl-tui` binary if Go is available.

## Project Structure

```
.
├── index.js                  CLI entry point
├── src/                      Node.js CLI, engine adapter, and rollback engine
│   ├── cli.js
│   ├── download.js
│   ├── tracker.js
│   ├── dht.js
│   ├── message.js
│   ├── Pieces.js
│   ├── Queue.js
│   ├── RarityMap.js
│   ├── state.js
│   ├── verify.js
│   ├── nat.js
│   ├── torrent-parser.js
│   ├── magnet-parser.js
│   ├── magnet-resolver.js
│   └── metadata-downloader.js
├── tui/                      Go anacrolix engine + Bubble Tea TUI
│   ├── main.go
│   ├── engine/
│   └── torl/
├── tests/                    Test suite using node:test
│   ├── fixtures/
│   └── mocks/
├── assets/                   Logo and preview images
├── README.md
├── CONTRIBUTING.md
└── LICENSE
```

## Running Tests

Run the full test suite:

```bash
npm test
```

Run a single test file:

```bash
npm test -- tests/download.test.js
```

Run live tracker tests separately (requires network access):

```bash
npm test -- tests/live-tracker.test.js
```

## Code Style

- **ESM only**: all source files are ES modules (`"type": "module"` in `package.json`).
- `'use strict';` at the top of every JavaScript file.
- Prefer named exports for utilities; default exports are acceptable for the main class/function of a module.
- Keep functions small and focused.
- Convert `Uint8Array` byte strings to `Buffer` early (see `src/torrent-parser.js`) for compatibility with the rest of the code.
- Use `BigInt` for the few cases that need 64-bit integers; avoid external bignum libraries.
- Use `node:test` and `node:assert` for tests; no additional test framework is required.
- Follow existing naming and patterns in the file you are editing.

## Adding Tests

- Add unit tests next to the relevant source file under `tests/` (e.g. `src/download.js` -> `tests/download.test.js`).
- Use the mock helpers in `tests/mocks/` for deterministic peer/tracker/DHT/NAT tests.
- Add fixture torrents to `tests/fixtures/` if needed.
- Ensure tests clean up temporary files in a `finally` block.
- Keep live network tests separate and clearly named (see `tests/live-tracker.test.js`).

## Submitting Changes

1. **Open an issue first** for large features or architectural changes so we can discuss direction.
2. **Keep changes minimal** — fix one thing per PR.
3. **Run the test suite** before opening a PR:
   ```bash
   npm test
   ```
4. **Update documentation** if you change CLI flags, behavior, or architecture.
5. **Do not commit secrets, `.env` files, or large binaries.**
6. Write clear commit messages and a descriptive PR title.

## TUI Development

The TUI is a Go module in `tui/`.

Build it manually:

```bash
cd tui
go build -o torl-tui .
```

Run TUI tests:

```bash
cd tui
go test ./...
```

The deterministic engine integration test uses loopback sockets only. Public-network tests must remain optional and separate.

The Node.js `bin/torl-tui.js` wrapper looks for the binary at `tui/torl-tui` first, then in `$PATH`.

## Questions?

Feel free to open an issue for questions, bug reports, or feature suggestions.
