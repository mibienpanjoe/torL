#!/usr/bin/env node
'use strict';

import { parseArgs } from '../src/cli.js';
import { _run } from '../src/cli.js';

const options = parseArgs(process.argv);

if (options.help) {
  console.log(`Usage: torl-cli <torrent-file|magnet-link>... [options]

Options:
  -o, --output <dir>       Output directory (default: Downloads)
  -c, --concurrency <n>    Max simultaneous downloads (default: 1)
  -q, --quiet              Suppress progress output
  --json                   Emit machine-readable JSON events on stdout
  -h, --help               Show this help message
  -v, --version            Show version
`);
  process.exit(0);
}

if (options.version) {
  const { readFileSync } = await import('fs');
  const { join } = await import('path');
  const { fileURLToPath } = await import('url');
  const __dirname = join(fileURLToPath(import.meta.url), '..', '..');
  const pkg = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

if (options.inputs.length === 0) {
  console.error('Missing torrent file or magnet link');
  process.exit(1);
}

const controller = new AbortController();
options.signal = controller.signal;

let shuttingDown = false;

function shutdown() {
  if (shuttingDown) {
    process.exit(1);
  }
  shuttingDown = true;
  controller.abort();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

try {
  await _run(options);
  process.exit(0);
} catch (err) {
  if (shuttingDown) {
    process.exit(0);
  }
  console.error(err.message);
  process.exit(1);
}
