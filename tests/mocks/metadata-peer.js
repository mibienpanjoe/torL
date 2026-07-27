'use strict';

import net from 'net';
import { Buffer } from 'buffer';
import bencode from 'bencode';
import * as message from '../../src/message.js';
import * as torrentParser from '../../src/torrent-parser.js';

export function createMockMetadataPeer(torrent, options = {}) {
  const { port = 0 } = options;
  const infoHash = torrentParser.infoHash(torrent);
  const metadata = Buffer.from(bencode.encode(torrent.info));

  const server = net.createServer(socket => {
    let receivedHandshake = false;
    let savedBuf = Buffer.alloc(0);
    let handshake = true;
    let peerUtMetadataId = null;

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
            socket.write(message.buildExtHandshake(metadata.length));
          } else {
            socket.end();
            return;
          }
        } else {
          const m = message.parse(msg);
          if (m.id === 20 && m.extId === 0) {
            const ext = message.parseExtHandshake(msg);
            if (ext && ext.utMetadata) {
              peerUtMetadataId = ext.utMetadata;
            }
          } else if (m.id === 20 && peerUtMetadataId && m.extId === peerUtMetadataId) {
            const meta = message.parseMetadataMessage(msg);
            if (meta.msgType === 0) {
              const pieceSize = 16384;
              const start = meta.piece * pieceSize;
              const piece = metadata.slice(start, start + pieceSize);
              socket.write(message.buildMetadataData(meta.piece, piece, 1));
            }
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
        metadata,
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
