'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  generateNodeId,
  distance,
  compareDistance,
  encodePing,
  encodeFindNode,
  encodeGetPeers,
  encodeAnnouncePeer,
  encodeResponse,
  decodeMessage,
  parseCompactNodes,
  encodeCompactNodes,
  parseCompactPeers,
  encodeCompactPeers,
  NODE_ID_LEN
} from '../src/dht.js';

describe('dht', () => {
  it('generates a 20-byte node ID', () => {
    const id = generateNodeId();
    assert.strictEqual(id.length, NODE_ID_LEN);
  });

  it('computes XOR distance', () => {
    const a = Buffer.alloc(NODE_ID_LEN, 0x00);
    const b = Buffer.alloc(NODE_ID_LEN, 0xff);
    const d = distance(a, b);
    assert.ok(d.every(b => b === 0xff));
  });

  it('compares distance buffers', () => {
    const a = Buffer.from([0x00, 0x00]);
    const b = Buffer.from([0x00, 0x01]);
    const c = Buffer.from([0x01, 0x00]);
    assert.strictEqual(compareDistance(a, b), -1);
    assert.strictEqual(compareDistance(b, a), 1);
    assert.strictEqual(compareDistance(c, b), 1);
  });

  it('encodes and decodes a ping query', () => {
    const tid = Buffer.from('aa', 'hex');
    const id = generateNodeId();
    const encoded = encodePing(tid, id);
    const decoded = decodeMessage(encoded);
    assert.strictEqual(decoded.y.toString('utf8'), 'q');
    assert.strictEqual(decoded.q.toString('utf8'), 'ping');
    assert.ok(decoded.a.id.equals(id));
    assert.ok(decoded.t.equals(tid));
  });

  it('encodes and decodes a find_node query', () => {
    const tid = Buffer.from('bb', 'hex');
    const id = generateNodeId();
    const target = generateNodeId();
    const encoded = encodeFindNode(tid, id, target);
    const decoded = decodeMessage(encoded);
    assert.strictEqual(decoded.q.toString('utf8'), 'find_node');
    assert.ok(decoded.a.target.equals(target));
  });

  it('encodes and decodes a get_peers query', () => {
    const tid = Buffer.from('cc', 'hex');
    const id = generateNodeId();
    const infoHash = generateNodeId();
    const encoded = encodeGetPeers(tid, id, infoHash);
    const decoded = decodeMessage(encoded);
    assert.strictEqual(decoded.q.toString('utf8'), 'get_peers');
    assert.ok(decoded.a['info_hash'].equals(infoHash));
  });

  it('encodes and decodes an announce_peer query', () => {
    const tid = Buffer.from('dd', 'hex');
    const id = generateNodeId();
    const infoHash = generateNodeId();
    const token = Buffer.from('token');
    const encoded = encodeAnnouncePeer(tid, id, infoHash, 6881, token);
    const decoded = decodeMessage(encoded);
    assert.strictEqual(decoded.q.toString('utf8'), 'announce_peer');
    assert.strictEqual(decoded.a.port, 6881);
    assert.ok(decoded.a.token.equals(token));
  });

  it('encodes and decodes a response', () => {
    const tid = Buffer.from('ee', 'hex');
    const id = generateNodeId();
    const encoded = encodeResponse(tid, { id });
    const decoded = decodeMessage(encoded);
    assert.strictEqual(decoded.y.toString('utf8'), 'r');
    assert.ok(decoded.r.id.equals(id));
  });

  it('round-trips compact nodes', () => {
    const nodes = [
      { id: generateNodeId(), ip: '127.0.0.1', port: 6881 },
      { id: generateNodeId(), ip: '192.168.1.1', port: 51413 }
    ];
    const encoded = encodeCompactNodes(nodes);
    const decoded = parseCompactNodes(encoded);
    assert.strictEqual(decoded.length, 2);
    assert.ok(decoded[0].id.equals(nodes[0].id));
    assert.strictEqual(decoded[0].ip, '127.0.0.1');
    assert.strictEqual(decoded[0].port, 6881);
  });

  it('round-trips compact peers', () => {
    const peers = [
      { ip: '127.0.0.1', port: 6881 },
      { ip: '192.168.1.1', port: 51413 }
    ];
    const encoded = encodeCompactPeers(peers);
    const decoded = parseCompactPeers(encoded);
    assert.strictEqual(decoded.length, 2);
    assert.strictEqual(decoded[0].ip, '127.0.0.1');
    assert.strictEqual(decoded[0].port, 6881);
  });
});
