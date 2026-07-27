'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import * as torrentParser from '../src/torrent-parser.js';
import { parseMagnetLink } from '../src/magnet-parser.js';
import { resolveMagnet } from '../src/magnet-resolver.js';
import { createMockMetadataPeer } from './mocks/metadata-peer.js';

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
      assert.deepStrictEqual(resolved.announceList, [['udp://tracker.example.com:80']]);
    } finally {
      peer.close();
    }
  });
});
