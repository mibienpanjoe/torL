import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { createServer } from 'http';
import { tmpdir } from 'os';
import { join } from 'path';
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  downloadBinary,
  getArch,
  getAssetName,
  getPackageVersion,
  getPlatform,
} from '../scripts/install-tui.js';

describe('install-tui', () => {
  it('reads the package version', () => {
    const dir = mkdtempSync(join(tmpdir(), 'torl-install-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '2.3.4' }));
    assert.strictEqual(getPackageVersion(dir), '2.3.4');
  });

  it('maps the current platform', () => {
    const platform = getPlatform();
    if (process.platform === 'linux') assert.strictEqual(platform, 'linux');
    if (process.platform === 'darwin') assert.strictEqual(platform, 'darwin');
    if (process.platform === 'win32') assert.strictEqual(platform, 'windows');
  });

  it('maps the current architecture', () => {
    const arch = getArch();
    if (process.arch === 'x64') assert.strictEqual(arch, 'x64');
    if (process.arch === 'arm64') assert.strictEqual(arch, 'arm64');
  });

  it('builds the release asset name', () => {
    const asset = getAssetName('1.2.3');
    assert.ok(asset.startsWith('torl-tui-v1.2.3-'));
    if (process.platform === 'win32') {
      assert.ok(asset.endsWith('.exe'));
    } else {
      assert.ok(!asset.endsWith('.exe'));
    }
  });

  it('downloads a binary from a mock release server', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torl-install-'));
    const dest = join(dir, 'torl-tui');
    const payload = Buffer.from('mock binary');

    const server = createServer((req, res) => {
      if (req.url === '/releases/download/v1.0.0/torl-tui-v1.0.0-linux-x64') {
        res.writeHead(200, { 'Content-Length': payload.length });
        res.end(payload);
      } else {
        res.writeHead(404);
        res.end('not found');
      }
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/releases/download/v1.0.0/torl-tui-v1.0.0-linux-x64`;

    const result = await downloadBinary(url, dest);
    assert.strictEqual(result, 0);
    assert.deepStrictEqual(readFileSync(dest), payload);

    server.close();
  });

  it('returns a non-zero status when the download fails', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'torl-install-'));
    const dest = join(dir, 'torl-tui');

    const server = createServer((req, res) => {
      res.writeHead(404);
      res.end('not found');
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}/releases/download/v1.0.0/torl-tui-v1.0.0-linux-x64`;

    const result = await downloadBinary(url, dest);
    assert.notStrictEqual(result, 0);
    assert.ok(!existsSync(dest));

    server.close();
  });
});
