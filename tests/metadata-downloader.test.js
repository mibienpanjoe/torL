'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import net from 'net';
import path from 'path';
import * as torrentParser from '../src/torrent-parser.js';
import { downloadMetadata, infoHashFromMetadata } from '../src/metadata-downloader.js';
import { parseMagnetLink } from '../src/magnet-parser.js';
import { createMockMetadataPeer } from './mocks/metadata-peer.js';

const torrentPath = path.join(process.cwd(), 'tests', 'fixtures', 'single-file.torrent');

describe('metadata-downloader', () => {
  it('downloads metadata from a mock peer', async () => {
    const torrent = torrentParser.open(torrentPath);
    const magnet = parseMagnetLink(`magnet:?xt=urn:btih:${torrentParser.infoHash(torrent).toString('hex')}`);
    const peer = await createMockMetadataPeer(torrent);
    try {
      const result = await downloadMetadata(peer, magnet.infoHash, { timeout: 5000 });
      assert.ok(result.info);
      assert.strictEqual(result.info.name.toString('utf8'), torrent.info.name.toString('utf8'));
      assert.strictEqual(result.info.length, torrent.info.length);
    } finally {
      peer.close();
    }
  });

  it('handles different metadata extension IDs in each direction', async () => {
    const torrent = torrentParser.open(torrentPath);
    const peer = await createMockMetadataPeer(torrent, { utMetadataId: 2 });
    try {
      const result = await downloadMetadata(peer, torrentParser.infoHash(torrent), { timeout: 500 });
      assert.strictEqual(result.info.name.toString('utf8'), torrent.info.name.toString('utf8'));
    } finally {
      peer.close();
    }
  });

  it('rejects when the handshake info hash does not match', async () => {
    const torrent = torrentParser.open(torrentPath);
    const peer = await createMockMetadataPeer(torrent);
    try {
      const badHash = Buffer.alloc(20, 0xff);
      await assert.rejects(
        downloadMetadata(peer, badHash, { timeout: 5000 }),
        /Peer disconnected/
      );
    } finally {
      peer.close();
    }
  });

  it('computes the info hash from metadata', async () => {
    const torrent = torrentParser.open(torrentPath);
    const peer = await createMockMetadataPeer(torrent);
    try {
      const result = await downloadMetadata(peer, torrentParser.infoHash(torrent), { timeout: 5000 });
      const hash = infoHashFromMetadata(result.metadata);
      assert.ok(hash.equals(torrentParser.infoHash(torrent)));
    } finally {
      peer.close();
    }
  });

  it('aborts an in-progress metadata download', async () => {
    const torrent = torrentParser.open(torrentPath);
    const server = net.createServer(() => {});
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const controller = new AbortController();
    const address = server.address();

    try {
      const pending = downloadMetadata(
        { ip: '127.0.0.1', port: address.port },
        torrentParser.infoHash(torrent),
        { timeout: 200, signal: controller.signal }
      );
      controller.abort();
      await assert.rejects(pending, err => err.name === 'AbortError');
    } finally {
      server.close();
    }
  });

  it('rejects an advertised metadata size above the safety limit', async () => {
    const torrent = torrentParser.open(torrentPath);
    const peer = await createMockMetadataPeer(torrent, {
      advertisedMetadataSize: 4 * 1024 * 1024 + 1
    });
    try {
      await assert.rejects(
        downloadMetadata(peer, torrentParser.infoHash(torrent), { timeout: 500 }),
        /Metadata size exceeds 4 MiB limit/
      );
    } finally {
      peer.close();
    }
  });
});
