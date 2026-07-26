'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import path from 'path';
import { fileURLToPath } from 'url';
import * as torrentParser from '../src/torrent-parser.js';
import * as tracker from '../src/tracker.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('live tracker', { timeout: 30000 }, () => {
  it('gets peers from a public HTTP tracker (Debian netinst)', async () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'debian-13.6.0-amd64-netinst.iso.torrent'));
    const peers = await new Promise((resolve, reject) => {
      tracker.getPeers(torrent, resolve);
    });
    assert.ok(peers.length > 0, 'expected at least one peer from the tracker');
    assert.ok(peers[0].ip, 'expected peer to have an IP address');
    assert.ok(peers[0].port > 0, 'expected peer to have a port');
  });
});
