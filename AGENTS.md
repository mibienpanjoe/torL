# AGENTS.md

## Project overview
- Node.js BitTorrent client, CommonJS (`"type": "commonjs"` in `package.json`).
- CLI entry point: `node index.js <torrent-file>`; output is written to the torrent's `info.name` path.
- No README or other docs; the code is the only source of truth.

## Developer commands
- `npm test` is a placeholder and exits with an error; there are no real tests yet.
- No build, lint, or formatter scripts exist.
- `npm install` requires a working native build toolchain (Python, C++ compiler) because `bignum` depends on `nan` bindings.

## Dependencies
- `bignum` is used in `src/torrent-parser.js` for `toBuffer` / `fromBuffer` on torrent sizes.
- `save` is declared in `package.json` but is not imported or used anywhere in the source.
