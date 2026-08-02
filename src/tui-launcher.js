'use strict';

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const binaryName = process.platform === 'win32' ? 'torl-tui.exe' : 'torl-tui';

export function findBinary() {
  const localBinary = join(packageRoot, 'tui', binaryName);
  if (existsSync(localBinary)) {
    return localBinary;
  }

  const pathEnv = process.env.PATH || '';
  const paths = pathEnv.split(process.platform === 'win32' ? ';' : ':');
  for (const dir of paths) {
    const candidate = join(dir, binaryName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

export function getUsage() {
  return `Usage: torl [options] [torrent-file|magnet-link]...

Running torl without inputs opens the interactive dashboard.

Options:
  -o, --output <dir>  Output directory (default: Downloads)
  -torl-path <path>    Path to the torl-cli executable (default: torl-cli)
  -h, --help           Show this help message
`;
}

export function runTui(args, dependencies = {}) {
  const locateBinary = dependencies.findBinary ?? findBinary;
  const spawn = dependencies.spawn ?? spawnSync;
  const writeOut = dependencies.writeOut ?? console.log;
  const writeErr = dependencies.writeErr ?? console.error;

  if (args.includes('-h') || args.includes('--help')) {
    writeOut(getUsage());
    return 0;
  }

  const binary = locateBinary();
  if (!binary) {
    writeErr('torl-tui binary not found.');
    writeErr('Install Go and run: cd tui && go build -o torl-tui .');
    writeErr('Or re-run npm install if Go is available.');
    return 1;
  }

  const result = spawn(binary, args, {
    stdio: 'inherit',
    env: process.env
  });

  if (result.error) {
    writeErr(`Unable to launch torl-tui: ${result.error.message}`);
    return 1;
  }

  return result.status ?? 1;
}
