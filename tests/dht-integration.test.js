'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { DHTClient } from '../src/dht.js';
import { createMockDHTNode } from './mocks/dht.js';

describe('dht integration', () => {
  it('finds peers through a mock DHT lookup', async () => {
    const infoHash = Buffer.alloc(20, 'A');
    const expectedPeers = [{ ip: '10.0.0.1', port: 6881 }, { ip: '10.0.0.2', port: 6882 }];

    const target = await createMockDHTNode({
      peers: new Map([[infoHash.toString('hex'), expectedPeers]])
    });

    const bootstrap = await createMockDHTNode({
      neighbors: [{ id: target.id, ip: target.ip, port: target.port }]
    });

    const client = new DHTClient({
      bootstrapNodes: [{ ip: bootstrap.ip, port: bootstrap.port }]
    });
    await client.start();

    try {
      const peers = await new Promise((resolve) => {
        client.findPeers({ infoHash }, resolve);
      });
      assert.strictEqual(peers.length, 2);
      assert.ok(peers.some(p => p.ip === '10.0.0.1' && p.port === 6881));
      assert.ok(peers.some(p => p.ip === '10.0.0.2' && p.port === 6882));
    } finally {
      client.stop();
      bootstrap.close();
      target.close();
    }
  });

  it('returns empty peers when the DHT has no target', async () => {
    const bootstrap = await createMockDHTNode({
      neighbors: []
    });

    const client = new DHTClient({
      bootstrapNodes: [{ ip: bootstrap.ip, port: bootstrap.port }]
    });
    await client.start();

    try {
      const infoHash = Buffer.alloc(20, 'B');
      const peers = await new Promise((resolve) => {
        client.findPeers({ infoHash }, resolve);
      });
      assert.deepStrictEqual(peers, []);
    } finally {
      client.stop();
      bootstrap.close();
    }
  });
});
