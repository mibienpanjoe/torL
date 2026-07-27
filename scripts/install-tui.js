#!/usr/bin/env node
'use strict';

import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const tuiDir = join(rootDir, 'tui');
const binaryPath = join(tuiDir, 'torl-tui');

function main() {
  if (existsSync(binaryPath)) {
    console.log('torl-tui binary already exists; skipping build.');
    return 0;
  }

  const go = findGo();
  if (!go) {
    console.warn('Go is not installed. torl-tui will not be built.');
    console.warn('Install Go and run: cd tui && go build -o torl-tui .');
    return 0;
  }

  console.log('Building torl-tui...');
  const result = spawnSync(go, ['build', '-o', 'torl-tui', '.'], {
    cwd: tuiDir,
    stdio: 'inherit',
    env: process.env
  });

  if (result.status !== 0) {
    console.error('Failed to build torl-tui.');
    return result.status || 1;
  }

  console.log('torl-tui built successfully.');
  return 0;
}

function findGo() {
  const candidates = ['go'];
  const home = process.env.HOME || process.env.USERPROFILE;
  if (home) {
    candidates.push(join(home, '.local', 'go', 'go', 'bin', 'go'));
  }
  for (const name of candidates) {
    const result = spawnSync(name, ['version'], { shell: true, stdio: 'pipe' });
    if (result.status === 0) {
      return name;
    }
  }
  return null;
}

process.exit(main());
