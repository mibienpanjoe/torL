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
import { createMockPeer, createFlakyPeer } from './mocks/peer.js';

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

  it('downloads a multi-file torrent from mock tracker and peer', async () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'multi-file.torrent'));
    const file1 = Buffer.from('Hello');
    const file2 = Buffer.from(' World!');
    const data = Buffer.concat([file1, file2]);

    const peer = await createMockPeer(torrent, data);
    const tracker = await createMockTracker(0, [{ ip: peer.ip, port: peer.port }]);
    torrent.announce = Buffer.from(tracker.url);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-'));
    const destPath = path.join(tmpDir, 'test');

    try {
      await download(torrent, destPath);
      const downloaded1 = fs.readFileSync(path.join(destPath, 'a.txt'));
      const downloaded2 = fs.readFileSync(path.join(destPath, 'b.txt'));
      assert.deepStrictEqual(downloaded1, file1);
      assert.deepStrictEqual(downloaded2, file2);
    } finally {
      tracker.close();
      peer.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  it('retries a failed peer and completes the download', async () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'single-file.torrent'));
    const data = Buffer.from('Hello, World!');

    const peer = await createFlakyPeer(torrent, data, { dropCount: 1 });
    const tracker = await createMockTracker(0, [{ ip: peer.ip, port: peer.port }]);
    torrent.announce = Buffer.from(tracker.url);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-'));
    const destPath = path.join(tmpDir, 'test.txt');

    try {
      await download(torrent, destPath, { retryDelay: 50 });
      const downloaded = fs.readFileSync(destPath);
      assert.deepStrictEqual(downloaded, data);
    } finally {
      tracker.close();
      peer.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  it('re-announces to the tracker and refreshes the peer list', async () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'single-file.torrent'));
    const data = Buffer.from('Hello, World!');

    const peer = await createMockPeer(torrent, data, { delayMs: 100 });
    const tracker = await createMockTracker(0, [{ ip: peer.ip, port: peer.port }]);
    torrent.announce = Buffer.from(tracker.url);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-'));
    const destPath = path.join(tmpDir, 'test.txt');

    try {
      await download(torrent, destPath, { announceInterval: 50 });
      const downloaded = fs.readFileSync(destPath);
      assert.deepStrictEqual(downloaded, data);
      assert.ok(tracker.getAnnounceCount() >= 2, 'expected at least one re-announce');
    } finally {
      tracker.close();
      peer.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });
});
