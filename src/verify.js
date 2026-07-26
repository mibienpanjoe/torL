'use strict';

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as state from './state.js';

export function verifyPieces(torrent, rootPath, piecesToVerify = null) {
  const nPieces = torrent.info.pieces.length / 20;
  const bitfield = state.emptyBitfield(nPieces);
  const totalLength = torrent.info.files
    ? torrent.info.files.reduce((sum, f) => sum + f.length, 0)
    : torrent.info.length;
  const pieceLength = torrent.info['piece length'];

  for (let i = 0; i < nPieces; i++) {
    if (piecesToVerify && !state.hasBit(piecesToVerify, i)) continue;
    const offset = i * pieceLength;
    const length = Math.min(pieceLength, totalLength - offset);
    const data = readBytes(torrent, rootPath, offset, length);
    if (data.length !== length) continue;
    const expected = torrent.info.pieces.slice(i * 20, (i + 1) * 20);
    const actual = crypto.createHash('sha1').update(data).digest();
    if (expected.equals(actual)) {
      state.setBit(bitfield, i);
    }
  }

  return bitfield;
}

function readBytes(torrent, rootPath, offset, length) {
  const files = torrent.info.files
    ? torrent.info.files.map(f => ({
      length: f.length,
      path: path.join(rootPath, ...f.path.map(p => p.toString('utf8')))
    }))
    : [{ length: torrent.info.length, path: rootPath }];

  const result = Buffer.alloc(length);
  let bytesRead = 0;
  let fileOffset = 0;

  for (const file of files) {
    const fileStart = fileOffset;
    const fileEnd = fileOffset + file.length;
    const blockStart = offset;
    const blockEnd = offset + length;

    if (blockEnd <= fileStart || blockStart >= fileEnd) {
      fileOffset += file.length;
      continue;
    }

    const overlapStart = Math.max(blockStart, fileStart);
    const overlapEnd = Math.min(blockEnd, fileEnd);
    const resultOffset = overlapStart - blockStart;
    const fileReadOffset = overlapStart - fileStart;
    const readLength = overlapEnd - overlapStart;

    if (!fs.existsSync(file.path)) {
      fileOffset += file.length;
      continue;
    }

    const fd = fs.openSync(file.path, 'r');
    try {
      fs.readSync(fd, result, resultOffset, readLength, fileReadOffset);
      bytesRead += readLength;
    } catch (e) {
      // ignore read errors
    } finally {
      fs.closeSync(fd);
    }

    fileOffset += file.length;
  }

  return bytesRead === length ? result : Buffer.alloc(0);
}
