'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import * as torrentParser from '../src/torrent-parser.js';
import { parseMagnetLink } from '../src/magnet-parser.js';
import { resolveMagnet } from '../src/magnet-resolver.js';
import { createMockMetadataPeer } from './mocks/metadata-peer.js';
import { createMockTracker } from './mocks/tracker.js';

const torrentPath = path.join(process.cwd(), 'tests', 'fixtures', 'single-file.torrent');

describe('magnet-resolver', () => {
  it('resolves a magnet link using a mock metadata peer', async () => {
    const torrent = torrentParser.open(torrentPath);
    const infoHash = torrentParser.infoHash(torrent);
    const magnet = parseMagnetLink(`magnet:?xt=urn:btih:${infoHash.toString('hex')}&dn=Resolved&tr=udp://tracker.example.com:80`);
    const peer = await createMockMetadataPeer(torrent);
    try {
      const resolved = await resolveMagnet(magnet, { peers: [peer] });
      assert.ok(resolved.info);
      assert.strictEqual(resolved.name, 'test.txt');
      assert.strictEqual(resolved.infoHash.toString('hex'), infoHash.toString('hex'));
      assert.deepStrictEqual(resolved['announce-list'], [[Buffer.from('udp://tracker.example.com:80')]]);
      assert.deepStrictEqual(resolved.discoveredPeers, [{ ip: peer.ip, port: peer.port }]);
    } finally {
      peer.close();
    }
  });

  it('uses tracker peers without waiting for a slow DHT lookup', async () => {
    const torrent = torrentParser.open(torrentPath);
    const infoHash = torrentParser.infoHash(torrent);
    const peer = await createMockMetadataPeer(torrent);
    const tracker = await createMockTracker(0, [peer]);
    const magnet = parseMagnetLink(
      `magnet:?xt=urn:btih:${infoHash.toString('hex')}&tr=${encodeURIComponent(tracker.url)}`
    );
    const startedAt = Date.now();

    try {
      const resolved = await resolveMagnet(magnet, {
        dhtBootstrapNodes: [{ ip: '127.0.0.1', port: 1 }]
      });
      assert.strictEqual(resolved.name, 'test.txt');
      assert.ok(Date.now() - startedAt < 1500, 'resolver waited for the DHT despite tracker peers');
    } finally {
      tracker.close();
      peer.close();
    }
  });

  it('aborts metadata attempts through the resolver signal', async () => {
    const torrent = torrentParser.open(torrentPath);
    const infoHash = torrentParser.infoHash(torrent);
    const magnet = parseMagnetLink(`magnet:?xt=urn:btih:${infoHash.toString('hex')}`);
    const controller = new AbortController();
    const peer = await createMockMetadataPeer(torrent, {
      advertisedMetadataSize: 4 * 1024 * 1024
    });

    controller.abort();
    try {
      await assert.rejects(
        resolveMagnet(magnet, { peers: [peer], signal: controller.signal }),
        err => err.name === 'AbortError'
      );
    } finally {
      peer.close();
    }
  });

  it('ignores UDP tracker responses with the wrong transaction ID', async () => {
    const torrent = torrentParser.open(torrentPath);
    const infoHash = torrentParser.infoHash(torrent);
    const peer = await createMockMetadataPeer(torrent);
    const tracker = await createMockTracker(0, [peer], { wrongTransactionId: true });
    const magnet = parseMagnetLink(
      `magnet:?xt=urn:btih:${infoHash.toString('hex')}&tr=${encodeURIComponent(tracker.url)}`
    );

    try {
      await assert.rejects(
        resolveMagnet(magnet, { useDHT: false }),
        /No peers found for magnet link/
      );
    } finally {
      tracker.close();
      peer.close();
    }
  });

  it('treats UDP tracker DNS errors as a failed peer source', async () => {
    const torrent = torrentParser.open(torrentPath);
    const infoHash = torrentParser.infoHash(torrent);
    const magnet = parseMagnetLink(
      `magnet:?xt=urn:btih:${infoHash.toString('hex')}&tr=udp%3A%2F%2Ftracker.invalid%3A6969`
    );

    await assert.rejects(
      resolveMagnet(magnet, { useDHT: false }),
      /No peers found for magnet link/
    );
  });
});
