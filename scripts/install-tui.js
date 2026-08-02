#!/usr/bin/env node
'use strict';

import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const rootDir = join(__dirname, '..');
export const tuiDir = join(rootDir, 'tui');
export const binaryName = process.platform === 'win32' ? 'torl-tui.exe' : 'torl-tui';
export const binaryPath = join(tuiDir, binaryName);

export function getPackageVersion(root = rootDir) {
  const pkgPath = join(root, 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
  return pkg.version;
}

export function getPlatform() {
  switch (process.platform) {
    case 'linux':
      return 'linux';
    case 'darwin':
      return 'darwin';
    case 'win32':
      return 'windows';
    default:
      return null;
  }
}

export function getArch() {
  switch (process.arch) {
    case 'x64':
      return 'x64';
    case 'arm64':
      return 'arm64';
    default:
      return null;
  }
}

export function getAssetName(version) {
  const platform = getPlatform();
  const arch = getArch();
  if (!platform || !arch) return null;
  const suffix = platform === 'windows' ? '.exe' : '';
  return `torl-tui-v${version}-${platform}-${arch}${suffix}`;
}

export async function downloadBinary(url, dest) {
  const tempPath = `${dest}.tmp`;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'torl-installer' } });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(tempPath, buffer);

    renameSync(tempPath, dest);
    if (process.platform !== 'win32') {
      chmodSync(dest, 0o755);
    }
    return 0;
  } catch (err) {
    console.error(err.message);
    if (existsSync(tempPath)) {
      try { unlinkSync(tempPath); } catch {}
    }
    return 1;
  }
}

export function findGo() {
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

export function buildFromSource() {
  const go = findGo();
  if (!go) {
    console.warn('Go is not installed. torl-tui will not be built.');
    console.warn('Install Go and run: cd tui && go build -o torl-tui .');
    return 0;
  }

  console.log('Building torl-tui from source...');
  const result = spawnSync(go, ['build', '-o', binaryName, '.'], {
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

export async function main(options = {}) {
  const forceBuild = options.forceBuild ?? false;
  const binaryExists = options.binaryExists ?? existsSync;
  const build = options.build ?? buildFromSource;

  if (forceBuild) {
    return build();
  }

  if (binaryExists(binaryPath)) {
    console.log('torl-tui binary already exists; skipping install.');
    return 0;
  }

  const platform = getPlatform();
  const arch = getArch();
  if (platform && arch) {
    const version = getPackageVersion();
    const assetName = getAssetName(version);
    if (assetName) {
      const releaseUrl = `https://github.com/mibienpanjoe/torL/releases/download/v${version}/${assetName}`;
      console.log(`Downloading torl-tui ${version} for ${platform}-${arch}...`);
      const downloadResult = await downloadBinary(releaseUrl, binaryPath);
      if (downloadResult === 0) {
        console.log('torl-tui downloaded successfully.');
        return 0;
      }
      console.warn(`Download failed (${downloadResult}); falling back to build.`);
    }
  } else {
    console.warn(`Prebuilt binary not available for ${process.platform}-${process.arch}; falling back to build.`);
  }

  return build();
}

if (fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main({ forceBuild: process.argv.includes('--build') }).then((code) => process.exit(code));
}
