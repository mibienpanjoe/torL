'use strict';

import dgram from 'dgram';
import { Buffer } from 'buffer';

const CONNECTION_ID = Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01]);

export function createMockTracker(port = 0, peers = [], options = {}) {
  const interval = options.interval ?? 60;
  let announceCount = 0;
  const socket = dgram.createSocket('udp4');

  socket.on('message', (msg, rinfo) => {
    const action = msg.readUInt32BE(8);
    const transactionId = msg.readUInt32BE(12);

    if (action === 0) {
      const response = Buffer.alloc(16);
      response.writeUInt32BE(0, 0);
      response.writeUInt32BE(transactionId, 4);
      CONNECTION_ID.copy(response, 8);
      socket.send(response, 0, response.length, rinfo.port, rinfo.address);
      return;
    }

    if (action === 1) {
      announceCount++;
      const response = Buffer.alloc(20 + peers.length * 6);
      response.writeUInt32BE(1, 0);
      response.writeUInt32BE(transactionId, 4);
      response.writeUInt32BE(interval, 8);
      response.writeUInt32BE(0, 12); // leechers
      response.writeUInt32BE(peers.length, 16); // seeders
      peers.forEach((peer, i) => {
        const parts = peer.ip.split('.').map(Number);
        parts.forEach((part, j) => {
          response.writeUInt8(part, 20 + i * 6 + j);
        });
        response.writeUInt16BE(peer.port, 20 + i * 6 + 4);
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
        url: `udp://127.0.0.1:${address.port}`,
        port: address.port,
        getAnnounceCount: () => announceCount,
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
