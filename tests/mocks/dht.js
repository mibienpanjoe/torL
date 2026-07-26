'use strict';

import dgram from 'dgram';
import * as dht from '../../src/dht.js';

export function createMockDHTNode(options = {}) {
  const nodeId = options.nodeId || dht.generateNodeId();
  const port = options.port || 0;
  const peers = options.peers || new Map(); // infoHash hex -> [{ ip, port }]
  const neighbors = options.neighbors || [];
  const token = options.token || Buffer.from('token');

  const socket = dgram.createSocket('udp4');

  socket.on('message', (msg, rinfo) => {
    const decoded = dht.decodeMessage(msg);
    const tid = decoded.t;
    if (decoded.y.toString('utf8') !== 'q') return;

    const q = decoded.q.toString('utf8');
    if (q === 'ping') {
      const response = dht.encodeResponse(tid, { id: nodeId });
      socket.send(response, 0, response.length, rinfo.port, rinfo.address);
      return;
    }

    if (q === 'get_peers') {
      const infoHash = decoded.a['info_hash'].toString('hex');
      const foundPeers = peers.get(infoHash);
      if (foundPeers && foundPeers.length > 0) {
        const values = foundPeers.map(p => dht.encodeCompactPeers([p]));
        const response = dht.encodeResponse(tid, { id: nodeId, token, values });
        socket.send(response, 0, response.length, rinfo.port, rinfo.address);
      } else {
        const response = dht.encodeResponse(tid, {
          id: nodeId,
          token,
          nodes: dht.encodeCompactNodes(neighbors)
        });
        socket.send(response, 0, response.length, rinfo.port, rinfo.address);
      }
      return;
    }

    if (q === 'find_node') {
      const response = dht.encodeResponse(tid, {
        id: nodeId,
        nodes: dht.encodeCompactNodes(neighbors)
      });
      socket.send(response, 0, response.length, rinfo.port, rinfo.address);
    }
  });

  return new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.bind(port, () => {
      const address = socket.address();
      let closed = false;
      resolve({
        id: nodeId,
        ip: '127.0.0.1',
        port: address.port,
        close: () => {
          if (!closed) {
            closed = true;
            socket.close();
          }
        }
      });
    });
  });
}
