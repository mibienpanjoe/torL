'use strict';

import crypto from 'crypto';
import dgram from 'dgram';
import bencode from 'bencode';
import { Buffer } from 'buffer';
import * as torrentParser from './torrent-parser.js';

export const NODE_ID_LEN = 20;
export const COMPACT_NODE_LEN = 26;
export const COMPACT_PEER_LEN = 6;

export const DEFAULT_BOOTSTRAP = [
  { ip: 'router.bittorrent.com', port: 6881 },
  { ip: 'dht.transmissionbt.com', port: 6881 }
];

export function generateNodeId() {
  return crypto.randomBytes(NODE_ID_LEN);
}

export function distance(a, b) {
  const buf = Buffer.alloc(NODE_ID_LEN);
  for (let i = 0; i < NODE_ID_LEN; i++) {
    buf[i] = a[i] ^ b[i];
  }
  return buf;
}

export function compareDistance(a, b) {
  for (let i = 0; i < NODE_ID_LEN; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

export function encodePing(tid, nodeId) {
  return bencode.encode({ t: tid, y: 'q', q: 'ping', a: { id: nodeId } });
}

export function encodeFindNode(tid, nodeId, target) {
  return bencode.encode({ t: tid, y: 'q', q: 'find_node', a: { id: nodeId, target } });
}

export function encodeGetPeers(tid, nodeId, infoHash) {
  return bencode.encode({ t: tid, y: 'q', q: 'get_peers', a: { id: nodeId, info_hash: infoHash } });
}

export function encodeAnnouncePeer(tid, nodeId, infoHash, port, token) {
  return bencode.encode({
    t: tid,
    y: 'q',
    q: 'announce_peer',
    a: { id: nodeId, implied_port: 1, info_hash: infoHash, port, token }
  });
}

export function encodeResponse(tid, response) {
  return bencode.encode({ t: tid, y: 'r', r: response });
}

export function encodeError(tid, code, message) {
  return bencode.encode({ t: tid, y: 'e', e: [code, message] });
}

export function decodeMessage(buf) {
  const decoded = bencode.decode(buf);
  return convertBuffers(decoded);
}

function convertBuffers(value) {
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) return value.map(convertBuffers);
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = convertBuffers(value[key]);
    }
    return result;
  }
  return value;
}

export function parseCompactNodes(buf) {
  const nodes = [];
  for (let i = 0; i + COMPACT_NODE_LEN <= buf.length; i += COMPACT_NODE_LEN) {
    nodes.push({
      id: buf.slice(i, i + NODE_ID_LEN),
      ip: buf.slice(i + NODE_ID_LEN, i + NODE_ID_LEN + 4).join('.'),
      port: buf.readUInt16BE(i + NODE_ID_LEN + 4)
    });
  }
  return nodes;
}

export function encodeCompactNodes(nodes) {
  const buf = Buffer.alloc(nodes.length * COMPACT_NODE_LEN);
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    node.id.copy(buf, i * COMPACT_NODE_LEN);
    const parts = node.ip.split('.').map(Number);
    for (let j = 0; j < 4; j++) {
      buf[i * COMPACT_NODE_LEN + NODE_ID_LEN + j] = parts[j];
    }
    buf.writeUInt16BE(node.port, i * COMPACT_NODE_LEN + NODE_ID_LEN + 4);
  }
  return buf;
}

export function parseCompactPeers(buf) {
  const peers = [];
  for (let i = 0; i + COMPACT_PEER_LEN <= buf.length; i += COMPACT_PEER_LEN) {
    peers.push({
      ip: buf.slice(i, i + 4).join('.'),
      port: buf.readUInt16BE(i + 4)
    });
  }
  return peers;
}

export function encodeCompactPeers(peers) {
  const buf = Buffer.alloc(peers.length * COMPACT_PEER_LEN);
  for (let i = 0; i < peers.length; i++) {
    const parts = peers[i].ip.split('.').map(Number);
    for (let j = 0; j < 4; j++) {
      buf[i * COMPACT_PEER_LEN + j] = parts[j];
    }
    buf.writeUInt16BE(peers[i].port, i * COMPACT_PEER_LEN + 4);
  }
  return buf;
}

export function transactionId() {
  return crypto.randomBytes(2);
}

export class DHTClient {
  constructor(options = {}) {
    this.nodeId = options.nodeId || generateNodeId();
    this.port = options.port || 0;
    this.bootstrapNodes = options.bootstrapNodes || DEFAULT_BOOTSTRAP;
    this.routingTable = [];
    this.socket = dgram.createSocket('udp4');
    this.pending = new Map();
    this.running = false;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.socket.on('error', reject);
      this.socket.bind(this.port, () => {
        this.running = true;
        this.socket.removeListener('error', reject);
        this.socket.on('message', this._handleMessage.bind(this));
        resolve();
      });
    });
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    for (const { timeout } of this.pending.values()) {
      clearTimeout(timeout);
    }
    this.pending.clear();
    this.socket.close();
  }

  async findPeers(torrent, callback) {
    const infoHash = torrent.infoHash || torrentParser.infoHash(torrent);
    await this._bootstrap();
    const peers = await this._lookup(infoHash);
    callback(peers);
  }

  async _bootstrap() {
    for (const node of this.bootstrapNodes) {
      try {
        const response = await this._query(node, tid => encodePing(tid, this.nodeId));
        if (response && response.r && response.r.id) {
          this._addNode({ id: response.r.id, ip: node.ip, port: node.port });
        }
      } catch (e) {}
    }
  }

  async _lookup(infoHash) {
    const queried = new Set();
    const candidates = new Map();
    for (const node of this.routingTable) {
      candidates.set(`${node.ip}:${node.port}`, node);
    }
    let peers = [];

    const sortCandidates = () => {
      return Array.from(candidates.values())
        .sort((a, b) => compareDistance(distance(a.id, infoHash), distance(b.id, infoHash)));
    };

    while (true) {
      const sorted = sortCandidates();
      const toQuery = sorted.slice(0, 8).filter(n => !queried.has(`${n.ip}:${n.port}`));
      if (toQuery.length === 0) break;

      const responses = await Promise.all(toQuery.map(async (node) => {
        queried.add(`${node.ip}:${node.port}`);
        try {
          return await this._query(node, tid => encodeGetPeers(tid, this.nodeId, infoHash));
        } catch (e) {
          return null;
        }
      }));

      let addedNew = false;
      for (const response of responses) {
        if (!response || !response.r) continue;
        if (response.r.values) {
          peers.push(...parseCompactPeers(Buffer.concat(response.r.values)));
        }
        if (response.r.nodes) {
          const newNodes = parseCompactNodes(response.r.nodes);
          for (const n of newNodes) {
            const key = `${n.ip}:${n.port}`;
            if (!candidates.has(key)) {
              candidates.set(key, n);
              addedNew = true;
            }
          }
        }
      }

      if (peers.length > 0) break;
      if (!addedNew) break;
    }

    return peers;
  }

  _query(node, encodeFn) {
    return new Promise((resolve, reject) => {
      const tid = transactionId();
      const tidHex = tid.toString('hex');
      const timeout = setTimeout(() => {
        this.pending.delete(tidHex);
        reject(new Error('timeout'));
      }, 3000);
      this.pending.set(tidHex, {
        resolve,
        reject,
        timeout
      });
      this._send(node, encodeFn(tid));
    });
  }

  _addNode(node) {
    if (this.routingTable.some(n => n.ip === node.ip && n.port === node.port)) return;
    this.routingTable.push(node);
    this.routingTable.sort((a, b) => compareDistance(distance(a.id, this.nodeId), distance(b.id, this.nodeId)));
    if (this.routingTable.length > 200) {
      this.routingTable = this.routingTable.slice(0, 200);
    }
  }

  _send(node, message) {
    this.socket.send(message, 0, message.length, node.port, node.ip);
  }

  _handleMessage(msg, rinfo) {
    const decoded = decodeMessage(msg);
    const tid = decoded.t.toString('hex');
    const pending = this.pending.get(tid);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(tid);
    if (decoded.y.toString('utf8') === 'r') {
      pending.resolve(decoded);
    } else {
      pending.reject(new Error('error response'));
    }
  }
}
