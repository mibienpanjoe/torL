'use strict';

import net from 'net';
import { Buffer } from 'buffer';
import bencode from 'bencode';
import crypto from 'crypto';
import * as message from './message.js';

const METADATA_PIECE_SIZE = 16384;

export function downloadMetadata(peer, infoHash, options = {}) {
  const timeout = options.timeout || 30000;
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let savedBuf = Buffer.alloc(0);
    let handshake = true;
    let receivedHandshake = false;
    let peerUtMetadataId = null;
    let metadataSize = 0;
    let metadata = null;
    let requestedPiece = 0;
    let timer = null;
    let done = false;

    function cleanup() {
      if (timer) clearTimeout(timer);
      timer = null;
    }

    function finish(value) {
      if (done) return;
      done = true;
      cleanup();
      socket.destroy();
      resolve(value);
    }

    function fail(err) {
      if (done) return;
      done = true;
      cleanup();
      socket.destroy();
      reject(err);
    }

    function resetTimer() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        fail(new Error('Metadata download timed out'));
      }, timeout);
    }

    function msgLen() {
      return handshake ? savedBuf.readUInt8(0) + 49 : savedBuf.readInt32BE(0) + 4;
    }

    function requestNextPiece() {
      if (requestedPiece * METADATA_PIECE_SIZE >= metadataSize) {
        // verify and complete
        const hash = crypto.createHash('sha1').update(metadata).digest();
        if (!hash.equals(infoHash)) {
          fail(new Error('Metadata info hash mismatch'));
          return;
        }
        try {
          const info = bencode.decode(metadata);
          const converted = convertBuffers(info);
          finish({ info: converted, metadata });
        } catch (err) {
          fail(new Error('Failed to decode metadata: ' + err.message));
        }
        return;
      }
      socket.write(message.buildMetadataRequest(requestedPiece, peerUtMetadataId));
    }

    function onMessage(msg) {
      if (!receivedHandshake) {
        if (msg.toString('utf8', 1, 20) === 'BitTorrent protocol' &&
            msg.slice(28, 48).equals(infoHash)) {
          receivedHandshake = true;
          socket.write(message.buildExtHandshake());
        } else {
          fail(new Error('Invalid peer handshake'));
        }
        return;
      }

      const m = message.parse(msg);
      if (m.id === 20 && m.extId === 0) {
        const ext = message.parseExtHandshake(msg);
        if (ext && ext.utMetadata) {
          peerUtMetadataId = ext.utMetadata;
          metadataSize = ext.metadataSize || 0;
          if (!metadataSize || metadataSize <= 0) {
            fail(new Error('Peer did not advertise metadata size'));
            return;
          }
          metadata = Buffer.alloc(metadataSize);
          resetTimer();
          requestNextPiece();
        }
      } else if (m.id === 20 && peerUtMetadataId && m.extId === peerUtMetadataId) {
        const meta = message.parseMetadataMessage(msg);
        if (meta.msgType === 1 && meta.piece === requestedPiece && meta.data) {
          const start = meta.piece * METADATA_PIECE_SIZE;
          meta.data.copy(metadata, start);
          requestedPiece++;
          resetTimer();
          requestNextPiece();
        } else if (meta.msgType === 2) {
          fail(new Error('Peer rejected metadata piece'));
        }
      }
    }

    socket.on('error', err => fail(err));
    socket.on('close', () => {
      if (!done) fail(new Error('Peer disconnected before metadata download complete'));
    });

    socket.on('data', recvBuf => {
      savedBuf = Buffer.concat([savedBuf, recvBuf]);
      while (savedBuf.length >= 4 && savedBuf.length >= msgLen()) {
        const msg = savedBuf.slice(0, msgLen());
        savedBuf = savedBuf.slice(msgLen());
        handshake = false;
        resetTimer();
        onMessage(msg);
      }
    });

    socket.connect(peer.port, peer.ip, () => {
      resetTimer();
      socket.write(message.buildHandshakeFromInfoHash(infoHash));
    });
  });
}

function convertBuffers(value) {
  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }
  if (Array.isArray(value)) {
    return value.map(convertBuffers);
  }
  if (value !== null && typeof value === 'object') {
    const result = {};
    for (const key of Object.keys(value)) {
      result[key] = convertBuffers(value[key]);
    }
    return result;
  }
  return value;
}

export function infoHashFromMetadata(metadata) {
  return crypto.createHash('sha1').update(metadata).digest();
}
