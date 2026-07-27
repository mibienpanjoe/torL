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

export function parseArgs(argv) {
  const args = argv.slice(2);
  const options = {
    output: process.cwd(),
    quiet: false,
    json: false,
    help: false,
    version: false,
    input: null
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
    } else if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.input) {
      options.input = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return options;
}

export function getUsage() {
  return `Usage: torl <torrent-file|magnet-link> [options]

Options:
  -o, --output <dir>   Output directory (default: current directory)
  -q, --quiet          Suppress progress output
  --json               Emit machine-readable JSON events on stdout
  -h, --help           Show this help message
  -v, --version        Show version
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

  if (!options.input) {
    console.error(getUsage());
    throw new Error('Missing torrent file or magnet link');
  }

  if (options.json && options.quiet) {
    throw new Error('Cannot use --json and --quiet together');
  }

  const isMagnet = options.input.startsWith('magnet:');
  const torrent = isMagnet
    ? await resolveMagnet(parseMagnetLink(options.input))
    : torrentParser.open(options.input);

  const targetName = isMagnet
    ? torrent.name
    : torrent.info.name.toString('utf8');
  const rootPath = path.join(options.output, targetName);

  await fs.promises.mkdir(options.output, { recursive: true });

  if (options.json) {
    const totalPieces = torrent.info.pieces ? torrent.info.pieces.length / 20 : 0;
    emitJson({ type: 'start', name: targetName, total: torrentSize(torrent), totalPieces });
  }

  const log = options.quiet ? () => {} : (msg) => console.log(msg);
  const onProgress = options.json
    ? (event) => emitJson(event)
    : (event) => {
        if (event.type === 'progress') {
          const percent = (event.percent * 100).toFixed(1);
          log(`Progress: ${percent}% (${event.downloaded}/${event.total}) peers: ${event.activePeers}`);
        }
      };

  await download(torrent, rootPath, { log, onProgress });

  if (options.json) {
    emitJson({ type: 'complete', path: rootPath });
  } else {
    log(`Download complete: ${rootPath}`);
  }
  return 0;
}

function emitJson(event) {
  console.log(JSON.stringify(event));
}

export default run;
