'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import * as tracker from '../src/tracker.js';
import * as torrentParser from '../src/torrent-parser.js';
import { createMockTracker } from './mocks/tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('tracker', () => {
  it('gets peers from a mock tracker', async () => {
    const mockTracker = await createMockTracker(0, [{ ip: '127.0.0.1', port: 6881 }]);
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'single-file.torrent'));
    torrent.announce = Buffer.from(mockTracker.url);

    try {
      const peers = await new Promise((resolve, reject) => {
        tracker.getPeers(torrent, resolve);
      });
      assert.strictEqual(peers.length, 1);
      assert.strictEqual(peers[0].ip, '127.0.0.1');
      assert.strictEqual(peers[0].port, 6881);
    } finally {
      mockTracker.close();
    }
  });
});
