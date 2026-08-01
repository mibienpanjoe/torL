'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import * as torrentParser from '../src/torrent-parser.js';
import download from '../src/download.js';
import * as state from '../src/state.js';
import { createMockTracker } from './mocks/tracker.js';
import { createMockPeer, createFlakyPeer } from './mocks/peer.js';
import { createMockDHTNode } from './mocks/dht.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('download', () => {
  it('pipelines block requests to keep a latent peer busy', async () => {
    const blockCount = 8;
    const pieceLength = torrentParser.BLOCK_LEN * blockCount;
    const data = Buffer.alloc(pieceLength, 0x5a);
    const torrent = {
      announce: Buffer.alloc(0),
      info: {
        length: data.length,
        name: Buffer.from('pipeline.bin'),
        'piece length': pieceLength,
        pieces: Buffer.alloc(20)
      }
    };

    const peer = await createMockPeer(torrent, data, { requestDelayMs: 25 });
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-pipeline-'));
    const destPath = path.join(tmpDir, 'pipeline.bin');

    try {
      await download(torrent, destPath, {
        peers: [{ ip: peer.ip, port: peer.port }],
        useDHT: false
      });

      assert.deepStrictEqual(fs.readFileSync(destPath), data);
      assert.ok(
        peer.getMaxPendingRequests() >= 4,
        `expected pipelined requests, observed ${peer.getMaxPendingRequests()} in flight`
      );
    } finally {
      peer.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  it('downloads a single-file torrent from mock tracker and peer', async () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'single-file.torrent'));
    const data = Buffer.from('Hello, World!');

    const peer = await createMockPeer(torrent, data);
    const tracker = await createMockTracker(0, [{ ip: peer.ip, port: peer.port }]);
    torrent.announce = Buffer.from(tracker.url);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-'));
    const destPath = path.join(tmpDir, 'test.txt');

    try {
      await download(torrent, destPath, { useDHT: false });
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
    const file2 = Buffer.from(' World!\n');
    const data = Buffer.concat([file1, file2]);

    const peer = await createMockPeer(torrent, data);
    const tracker = await createMockTracker(0, [{ ip: peer.ip, port: peer.port }]);
    torrent.announce = Buffer.from(tracker.url);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-'));
    const destPath = path.join(tmpDir, 'test');

    try {
      await download(torrent, destPath, { useDHT: false });
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
      await download(torrent, destPath, { retryDelay: 50, useDHT: false });
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
      await download(torrent, destPath, { announceInterval: 50, useDHT: false });
      const downloaded = fs.readFileSync(destPath);
      assert.deepStrictEqual(downloaded, data);
      assert.ok(tracker.getAnnounceCount() >= 2, 'expected at least one re-announce');
    } finally {
      tracker.close();
      peer.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  it('resumes a partial download and only fetches missing pieces', async () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'resume.torrent'));
    const data = fs.readFileSync(path.join(__dirname, 'fixtures', 'resume.data'));
    const pieceLength = torrent.info['piece length'];

    // Pre-populate the first piece and a state file claiming it is done.
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-'));
    const destPath = path.join(tmpDir, 'resume.txt');
    fs.writeFileSync(destPath, data.slice(0, pieceLength));
    const savedBitfield = state.emptyBitfield(torrent.info.pieces.length / 20);
    state.setBit(savedBitfield, 0);
    state.save(destPath, savedBitfield);

    // Peer only has the second piece. If resume works, the download completes.
    const peer = await createMockPeer(torrent, data, { pieces: [1] });
    const tracker = await createMockTracker(0, [{ ip: peer.ip, port: peer.port }]);
    torrent.announce = Buffer.from(tracker.url);

    try {
      await download(torrent, destPath, { retryDelay: 50, useDHT: false });
      const downloaded = fs.readFileSync(destPath);
      assert.deepStrictEqual(downloaded, data);
    } finally {
      tracker.close();
      peer.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  it('downloads a torrent using DHT when no tracker is present', async () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'single-file.torrent'));
    const data = Buffer.from('Hello, World!');
    const infoHash = torrentParser.infoHash(torrent);

    const peer = await createMockPeer(torrent, data);
    const target = await createMockDHTNode({
      peers: new Map([[infoHash.toString('hex'), [{ ip: peer.ip, port: peer.port }]]])
    });
    const bootstrap = await createMockDHTNode({
      neighbors: [{ id: target.id, ip: target.ip, port: target.port }]
    });

    torrent.announce = Buffer.alloc(0);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-'));
    const destPath = path.join(tmpDir, 'test.txt');

    try {
      await download(torrent, destPath, {
        useDHT: true,
        dhtBootstrapNodes: [{ ip: bootstrap.ip, port: bootstrap.port }]
      });
      const downloaded = fs.readFileSync(destPath);
      assert.deepStrictEqual(downloaded, data);
    } finally {
      bootstrap.close();
      target.close();
      peer.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  it('starts from tracker peers without waiting for a slow DHT lookup', async () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'single-file.torrent'));
    const data = Buffer.from('Hello, World!');
    const peer = await createMockPeer(torrent, data);
    const tracker = await createMockTracker(0, [{ ip: peer.ip, port: peer.port }]);
    torrent.announce = Buffer.from(tracker.url);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-tracker-first-'));
    const destPath = path.join(tmpDir, 'test.txt');
    const startedAt = Date.now();

    try {
      await download(torrent, destPath, {
        useDHT: true,
        dhtBootstrapNodes: [{ ip: '127.0.0.1', port: 1 }]
      });
      assert.ok(Date.now() - startedAt < 1500, 'download waited for DHT despite tracker peers');
      assert.deepStrictEqual(fs.readFileSync(destPath), data);
    } finally {
      tracker.close();
      peer.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  it('saves state on graceful shutdown and resumes from it', async () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'single-file.torrent'));
    const data = Buffer.from('Hello, World!');
    const infoHash = torrentParser.infoHash(torrent);

    const peer = await createMockPeer(torrent, data);

    const target = await createMockDHTNode({
      peers: new Map([[infoHash.toString('hex'), [{ ip: peer.ip, port: peer.port }]]])
    });
    const bootstrap = await createMockDHTNode({
      neighbors: [{ id: target.id, ip: target.ip, port: target.port }]
    });

    torrent.announce = Buffer.alloc(0);

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-'));
    const destPath = path.join(tmpDir, 'test.txt');
    const statePath = `${destPath}.torl.state`;

    try {
      const controller = new AbortController();

      const downloadPromise = download(torrent, destPath, {
        useDHT: true,
        dhtBootstrapNodes: [{ ip: bootstrap.ip, port: bootstrap.port }],
        signal: controller.signal,
        saveInterval: 0
      });

      // Wait for some progress, then abort
      await new Promise(resolve => setTimeout(resolve, 200));
      controller.abort();

      await downloadPromise;

      assert.ok(fs.existsSync(statePath));
      assert.ok(fs.existsSync(destPath));
      const partial = fs.readFileSync(destPath);
      assert.ok(partial.length > 0);

      // Resume: re-download without signal should complete
      await download(torrent, destPath, {
        useDHT: true,
        dhtBootstrapNodes: [{ ip: bootstrap.ip, port: bootstrap.port }]
      });
      const downloaded = fs.readFileSync(destPath);
      assert.deepStrictEqual(downloaded, data);
    } finally {
      peer.close();
      bootstrap.close();
      target.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });
});
