'use strict';

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import download, { torrentSize } from './download.js';
import * as torrentParser from './torrent-parser.js';
import { parseMagnetLink } from './magnet-parser.js';
import { resolveMagnet } from './magnet-resolver.js';
import { readFileSync } from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageJson = JSON.parse(readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

export function getDefaultOutputDir() {
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    return path.join(home, 'Downloads');
  }
  return process.cwd();
}

export function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    output: getDefaultOutputDir(),
    quiet: false,
    json: false,
    help: false,
    version: false,
    concurrency: 1,
    inputs: []
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') {
      options.help = true;
    } else if (arg === '-v' || arg === '--version') {
      options.version = true;
    } else if (arg === '-q' || arg === '--quiet') {
      options.quiet = true;
    } else if (arg === '--json') {
      options.json = true;
    } else if (arg === '-o' || arg === '--output') {
      const value = args[++i];
      if (value === undefined) {
        throw new Error(`Option ${arg} requires a value`);
      }
      options.output = path.resolve(value);
    } else if (arg === '-c' || arg === '--concurrency') {
      const value = args[++i];
      if (value === undefined) {
        throw new Error(`Option ${arg} requires a value`);
      }
      const n = parseInt(value, 10);
      if (isNaN(n) || n < 1) {
        throw new Error(`Invalid concurrency value: ${value}`);
      }
      options.concurrency = n;
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.inputs.push(arg);
    }
  }

  return options;
}

export function getUsage() {
  return `Usage: torl-cli <torrent-file|magnet-link>... [options]

Options:
  -o, --output <dir>       Output directory (default: Downloads)
  -c, --concurrency <n>    Max simultaneous downloads (default: 1)
  -q, --quiet              Suppress progress output
  --json                   Emit machine-readable JSON events on stdout
  -h, --help               Show this help message
  -v, --version            Show version
`;
}

export async function run(argv = process.argv) {
  const options = parseArgs(argv);

  if (options.help) {
    console.log(getUsage());
    return 0;
  }

  if (options.version) {
    console.log(packageJson.version);
    return 0;
  }

  if (options.inputs.length === 0) {
    console.error(getUsage());
    throw new Error('Missing torrent file or magnet link');
  }

  if (options.json && options.quiet) {
    throw new Error('Cannot use --json and --quiet together');
  }

  await fs.promises.mkdir(options.output, { recursive: true });

  const progressLogger = options.json || options.quiet
    ? null
    : new MultiProgressLogger();

  return _run(options, progressLogger);
}

export async function _run(options, progressLogger) {
  const signal = options.signal || null;

  const results = await downloadAll(options.inputs, options, progressLogger, undefined, signal);

  const failures = results.filter(r => !r.success);
  if (failures.length > 0) {
    const messages = failures.map(f => `${f.input}: ${f.error.message}`).join('; ');
    throw new Error(`${failures.length} download(s) failed: ${messages}`);
  }

  return 0;
}

class MultiProgressLogger {
  constructor() {
    this.states = new Map();
    this.lastPrinted = new Map();
  }

  update(input, event) {
    if (event.type !== 'progress') return;
    this.states.set(input, event);
    const percent = Math.floor(event.percent * 100);
    const last = this.lastPrinted.get(input) || -1;
    if (percent > last || event.activePeers !== (this.states.get(input)?.activePeers)) {
      this.lastPrinted.set(input, percent);
      this.print(input, event);
    }
  }

  print(input, event) {
    const percent = (event.percent * 100).toFixed(1);
    const name = path.basename(input).slice(0, 30);
    const line = `[${name.padEnd(30)}] ${percent.padStart(5)}% (${formatBytes(event.downloaded)}/${formatBytes(event.total)}) peers: ${event.activePeers}`;
    console.log(line);
  }

  complete(input, rootPath) {
    console.log(`[${path.basename(input).slice(0, 30).padEnd(30)}] Complete: ${rootPath}`);
  }
}

export async function downloadAll(inputs, options, progressLogger, downloadOneFn = downloadOne, signal = null) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < inputs.length) {
      if (signal && signal.aborted) break;
      const input = inputs[index++];
      try {
        const rootPath = await downloadOneFn(input, options, progressLogger);
        if (progressLogger) {
          progressLogger.complete(input, rootPath);
        }
        results.push({ input, success: true, path: rootPath });
      } catch (err) {
        results.push({ input, success: false, error: err });
      }
    }
  }

  const workers = Array.from({ length: options.concurrency }, worker);
  await Promise.all(workers);
  return results;
}

async function downloadOne(input, options, progressLogger) {
  const isMagnet = input.startsWith('magnet:');
  const torrent = isMagnet
    ? await resolveMagnet(parseMagnetLink(input), { signal: options.signal })
    : torrentParser.open(input);

  const targetName = isMagnet
    ? torrent.name
    : torrent.info.name.toString('utf8');
  const rootPath = path.join(options.output, targetName);

  const id = input;

  if (options.json) {
    const totalPieces = torrent.info.pieces ? torrent.info.pieces.length / 20 : 0;
    emitJson({ type: 'start', id, name: targetName, total: torrentSize(torrent), totalPieces });
  }

  const log = options.quiet ? () => {} : (msg) => console.log(`[${path.basename(input)}] ${msg}`);
  const onProgress = options.json
    ? (event) => emitJson({ ...event, id })
    : (event) => {
        if (progressLogger) {
          progressLogger.update(id, event);
        }
      };

  await download(torrent, rootPath, {
    log,
    onProgress,
    signal: options.signal,
    initialPeers: isMagnet ? torrent.discoveredPeers : null
  });

  if (options.json && !options.signal?.aborted) {
    emitJson({ type: 'complete', id, path: rootPath });
  }

  return rootPath;
}

function emitJson(event) {
  console.log(JSON.stringify(event));
}

function formatBytes(n) {
  if (n >= 1 << 30) {
    return `${(n / (1 << 30)).toFixed(2)} GiB`;
  }
  if (n >= 1 << 20) {
    return `${(n / (1 << 20)).toFixed(2)} MiB`;
  }
  if (n >= 1 << 10) {
    return `${(n / (1 << 10)).toFixed(2)} KiB`;
  }
  return `${n} B`;
}

export default run;
