'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import * as torrentParser from '../src/torrent-parser.js';
import download from '../src/download.js';
import { createMockTracker } from './mocks/tracker.js';
import { createMockPeer } from './mocks/peer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('download', () => {
  it('downloads a single-file torrent from mock tracker and peer', async () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'single-file.torrent'));
    const data = Buffer.from('Hello, World!');

    const peer = await createMockPeer(torrent, data);
    const tracker = await createMockTracker(0, [{ ip: peer.ip, port: peer.port }]);
    torrent.announce = Buffer.from(tracker.url);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-'));
    const destPath = path.join(tmpDir, 'test.txt');

    try {
      await download(torrent, destPath);
      const downloaded = fs.readFileSync(destPath);
      assert.deepStrictEqual(downloaded, data);
    } finally {
      tracker.close();
      peer.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });
});
