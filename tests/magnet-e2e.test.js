'use strict';

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as torrentParser from '../src/torrent-parser.js';
import { parseMagnetLink } from '../src/magnet-parser.js';
import { resolveMagnet } from '../src/magnet-resolver.js';
import download from '../src/download.js';
import { createMockMetadataPeer } from './mocks/metadata-peer.js';
import { createMockPeer } from './mocks/peer.js';

const torrentPath = path.join(process.cwd(), 'tests', 'fixtures', 'single-file.torrent');

describe('magnet end-to-end', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-magnet-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('downloads a file from a magnet link using mock peers', async () => {
    const torrent = torrentParser.open(torrentPath);
    const infoHash = torrentParser.infoHash(torrent);
    const data = Buffer.from('Hello, World!');
    const magnet = parseMagnetLink(`magnet:?xt=urn:btih:${infoHash.toString('hex')}&dn=MagnetTest`);

    const metadataPeer = await createMockMetadataPeer(torrent);
    const filePeer = await createMockPeer(torrent, data);
    try {
      const resolved = await resolveMagnet(magnet, { peers: [metadataPeer] });
      await download(resolved, path.join(tmpDir, resolved.name), {
        peers: [filePeer],
        useDHT: false,
        log: () => {}
      });
      const downloaded = fs.readFileSync(path.join(tmpDir, resolved.name));
      assert.deepStrictEqual(downloaded, data);
    } finally {
      metadataPeer.close();
      filePeer.close();
    }
  });
});
