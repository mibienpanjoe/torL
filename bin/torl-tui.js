#!/usr/bin/env node
'use strict';

import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const localBinary = join(rootDir, 'tui', process.platform === 'win32' ? 'torl-tui.exe' : 'torl-tui');

function findBinary() {
  if (existsSync(localBinary)) {
    return localBinary;
  }

  // Search PATH
  const pathEnv = process.env.PATH || '';
  const paths = pathEnv.split(process.platform === 'win32' ? ';' : ':');
  for (const dir of paths) {
    const candidate = join(dir, process.platform === 'win32' ? 'torl-tui.exe' : 'torl-tui');
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function main() {
  const binary = findBinary();
  if (!binary) {
    console.error('torl-tui binary not found.');
    console.error('Install Go and run: cd tui && go build -o torl-tui .');
    console.error('Or re-run npm install if Go is available.');
    process.exit(1);
  }

  const result = spawnSync(binary, process.argv.slice(2), {
    stdio: 'inherit',
    env: process.env
  });

  process.exit(result.status ?? 0);
}

main();
