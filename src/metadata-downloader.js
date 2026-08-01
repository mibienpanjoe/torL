'use strict';

import net from 'net';
import { Buffer } from 'buffer';
import bencode from 'bencode';
import crypto from 'crypto';
import * as message from './message.js';

const METADATA_PIECE_SIZE = 16384;
const MAX_METADATA_SIZE = 4 * 1024 * 1024;

export function downloadMetadata(peer, infoHash, options = {}) {
  const timeout = options.timeout ?? 30000;
  const signal = options.signal;
  const maxMetadataSize = options.maxMetadataSize ?? MAX_METADATA_SIZE;

  if (signal?.aborted) {
    return Promise.reject(createAbortError());
  }

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
      signal?.removeEventListener('abort', onAbort);
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

    function onAbort() {
      fail(createAbortError());
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
          if (!Number.isSafeInteger(metadataSize) || metadataSize <= 0) {
            fail(new Error('Peer did not advertise metadata size'));
            return;
          }
          if (metadataSize > maxMetadataSize) {
            fail(new Error('Metadata size exceeds 4 MiB limit'));
            return;
          }
          metadata = Buffer.alloc(metadataSize);
          resetTimer();
          requestNextPiece();
        }
      } else if (m.id === 20 && peerUtMetadataId && m.extId === message.UT_METADATA_ID) {
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

    signal?.addEventListener('abort', onAbort, { once: true });
    resetTimer();
    socket.connect(peer.port, peer.ip, () => {
      socket.write(message.buildHandshakeFromInfoHash(infoHash));
    });
  });
}

function createAbortError() {
  const error = new Error('Metadata download aborted');
  error.name = 'AbortError';
  return error;
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
