'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import net from 'net';
import path from 'path';
import { fileURLToPath } from 'url';
import * as message from '../src/message.js';
import * as torrentParser from '../src/torrent-parser.js';
import { createMockPeer } from './mocks/peer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('mock peer', () => {
  it('serves a requested block', async () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'single-file.torrent'));
    const data = Buffer.from('Hello, World!'); // 13 bytes
    const peer = await createMockPeer(torrent, data);

    const client = new net.Socket();

    try {
      const piece = await new Promise((resolve, reject) => {
        client.on('error', reject);
        client.connect(peer.port, peer.ip, () => {
          client.write(message.buildHandshake(torrent));
        });

        let buf = Buffer.alloc(0);
        let handshake = true;
        let sentInterested = false;
        let sentRequest = false;

        function msgLen() {
          return handshake ? buf.readUInt8(0) + 49 : buf.readInt32BE(0) + 4;
        }

        function isHandshake(msg) {
          return msg.length === msg.readUInt8(0) + 49 &&
            msg.toString('utf8', 1, 20) === 'BitTorrent protocol';
        }

        client.on('data', chunk => {
          buf = Buffer.concat([buf, chunk]);
          while (buf.length >= 4 && buf.length >= msgLen()) {
            const msg = buf.slice(0, msgLen());
            buf = buf.slice(msgLen());
            handshake = false;

            if (isHandshake(msg)) {
              client.write(message.buildInterested());
              sentInterested = true;
            } else {
              const m = message.parse(msg);
              if (m.id === 1 && sentInterested) {
                // unchoke
                client.write(message.buildRequest({ index: 0, begin: 0, length: 13 }));
                sentRequest = true;
              } else if (m.id === 7 && sentRequest) {
                resolve(m.payload);
              }
            }
          }
        });
      });

      assert.strictEqual(piece.index, 0);
      assert.strictEqual(piece.begin, 0);
      assert.deepStrictEqual(piece.block, data);
    } finally {
      client.destroy();
      peer.close();
    }
  });
});
