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
      const { peers, interval } = await new Promise((resolve, reject) => {
        tracker.getPeers(torrent, (peers, interval) => {
          resolve({ peers, interval });
        });
      });
      assert.strictEqual(peers.length, 1);
      assert.strictEqual(interval, 60);
      assert.strictEqual(peers[0].ip, '127.0.0.1');
      assert.strictEqual(peers[0].port, 6881);
    } finally {
      mockTracker.close();
    }
  });

  it('falls back to the next tracker when the first one fails', async () => {
    const goodTracker = await createMockTracker(0, [{ ip: '127.0.0.1', port: 6882 }]);
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'single-file.torrent'));
    torrent.announce = Buffer.from('udp://127.0.0.1:1');
    torrent['announce-list'] = [
      [Buffer.from('udp://127.0.0.1:1')],
      [Buffer.from(goodTracker.url)]
    ];

    process.env.TORL_TRACKER_TIMEOUT = '500';
    try {
      const { peers, interval } = await new Promise((resolve, reject) => {
        tracker.getPeers(torrent, (peers, interval) => {
          resolve({ peers, interval });
        });
      });
      assert.strictEqual(peers.length, 1);
      assert.strictEqual(interval, 60);
      assert.strictEqual(peers[0].ip, '127.0.0.1');
      assert.strictEqual(peers[0].port, 6882);
    } finally {
      delete process.env.TORL_TRACKER_TIMEOUT;
      goodTracker.close();
    }
  });
});
