'use strict';

import net from 'net';
import { Buffer } from 'buffer';
import * as message from '../../src/message.js';
import * as torrentParser from '../../src/torrent-parser.js';

export function createMockPeer(torrent, data, options = {}) {
  const { port = 0, delayMs = 0, pieces = null } = options;
  const nPieces = torrent.info.pieces.length / 20;
  const availablePieces = new Set(pieces || Array.from({ length: nPieces }, (_, i) => i));
  const server = net.createServer(socket => {
    let receivedHandshake = false;
    let savedBuf = Buffer.alloc(0);
    let handshake = true;

    const infoHash = torrentParser.infoHash(torrent);

    function msgLen() {
      return handshake ? savedBuf.readUInt8(0) + 49 : savedBuf.readInt32BE(0) + 4;
    }

    socket.on('data', recvBuf => {
      savedBuf = Buffer.concat([savedBuf, recvBuf]);

      while (savedBuf.length >= 4 && savedBuf.length >= msgLen()) {
        const msg = savedBuf.slice(0, msgLen());
        savedBuf = savedBuf.slice(msgLen());
        handshake = false;

        if (!receivedHandshake) {
          if (msg.toString('utf8', 1, 20) === 'BitTorrent protocol' &&
              msg.slice(28, 48).equals(infoHash)) {
            receivedHandshake = true;
            socket.write(message.buildHandshake(torrent));
            const bitfield = Buffer.alloc(Math.ceil(nPieces / 8));
            for (const p of availablePieces) {
              bitfield[Math.floor(p / 8)] |= 0x80 >> (p % 8);
            }
            setTimeout(() => {
              socket.write(message.buildBitfield(bitfield));
            }, delayMs);
          } else {
            socket.end();
            return;
          }
        } else {
          const m = message.parse(msg);
          if (m.id === 2) {
            setTimeout(() => socket.write(message.buildUnchoke()), delayMs);
          } else if (m.id === 6) {
            if (!availablePieces.has(m.payload.index)) return;
            const offset = m.payload.index * torrent.info['piece length'] + m.payload.begin;
            const block = data.slice(offset, offset + m.payload.length);
            socket.write(message.buildPiece({
              index: m.payload.index,
              begin: m.payload.begin,
              block
            }));
          }
        }
      }
    });

    socket.on('error', () => {});
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      const address = server.address();
      let closed = false;
      resolve({
        ip: '127.0.0.1',
        port: address.port,
        close: () => {
          if (!closed) {
            closed = true;
            server.close();
          }
        }
      });
    });
  });
}

export function createFlakyPeer(torrent, data, options = {}) {
  const { dropCount = 1, port = 0 } = options;
  let drops = 0;
  const server = net.createServer(socket => {
    let receivedHandshake = false;
    let savedBuf = Buffer.alloc(0);
    let handshake = true;

    const infoHash = torrentParser.infoHash(torrent);

    function msgLen() {
      return handshake ? savedBuf.readUInt8(0) + 49 : savedBuf.readInt32BE(0) + 4;
    }

    socket.on('data', recvBuf => {
      savedBuf = Buffer.concat([savedBuf, recvBuf]);

      while (savedBuf.length >= 4 && savedBuf.length >= msgLen()) {
        const msg = savedBuf.slice(0, msgLen());
        savedBuf = savedBuf.slice(msgLen());
        handshake = false;

        if (!receivedHandshake) {
          if (msg.toString('utf8', 1, 20) === 'BitTorrent protocol' &&
              msg.slice(28, 48).equals(infoHash)) {
            receivedHandshake = true;
            if (drops < dropCount) {
              drops++;
              socket.end();
              return;
            }
            socket.write(message.buildHandshake(torrent));
            // Advertise that we have all pieces via a bitfield.
            const nPieces = torrent.info.pieces.length / 20;
            const bitfield = Buffer.alloc(Math.ceil(nPieces / 8));
            for (let p = 0; p < nPieces; p++) {
              bitfield[Math.floor(p / 8)] |= 0x80 >> (p % 8);
            }
            socket.write(message.buildBitfield(bitfield));
          } else {
            socket.end();
            return;
          }
        } else {
          const m = message.parse(msg);
          if (m.id === 2) {
            socket.write(message.buildUnchoke());
          } else if (m.id === 6) {
            const offset = m.payload.index * torrent.info['piece length'] + m.payload.begin;
            const block = data.slice(offset, offset + m.payload.length);
            socket.write(message.buildPiece({
              index: m.payload.index,
              begin: m.payload.begin,
              block
            }));
          }
        }
      }
    });

    socket.on('error', () => {});
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      const address = server.address();
      let closed = false;
      resolve({
        ip: '127.0.0.1',
        port: address.port,
        close: () => {
          if (!closed) {
            closed = true;
            server.close();
          }
        }
      });
    });
  });
}
