'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
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
});
