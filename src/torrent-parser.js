'use strict';

import fs from 'fs';
import bencode from 'bencode';
import crypto from 'crypto';

export function open(filepath) {
  const data = fs.readFileSync(filepath);
  const decoded = bencode.decode(data);
  return convertBuffers(decoded);
}

export function size(torrent) {
  const size = torrent.info.files
    ? torrent.info.files.map(file => file.length).reduce((a, b) => a + b)
    : torrent.info.length;

  return toBuffer(size, 8);
}

export function infoHash(torrent) {
  const info = bencode.encode(torrent.info);
  return crypto.createHash('sha1').update(info).digest();
}

export const BLOCK_LEN = Math.pow(2, 14);

export function pieceLen(torrent, pieceIndex) {
  const totalLength = fromBuffer(size(torrent));
  const pieceLength = torrent.info['piece length'];

  const lastPieceLength = totalLength % pieceLength;
  const lastPieceIndex = Math.floor(totalLength / pieceLength);

  return lastPieceIndex === pieceIndex ? lastPieceLength : pieceLength;
}

export function blocksPerPiece(torrent, pieceIndex) {
  const pieceLength = pieceLen(torrent, pieceIndex);
  return Math.ceil(pieceLength / BLOCK_LEN);
}

export function blockLen(torrent, pieceIndex, blockIndex) {
  const pieceLength = pieceLen(torrent, pieceIndex);

  const lastPieceLength = pieceLength % BLOCK_LEN;
  const lastPieceIndex = Math.floor(pieceLength / BLOCK_LEN);

  return blockIndex === lastPieceIndex ? lastPieceLength : BLOCK_LEN;
}

function toBuffer(number, byteCount) {
  const value = BigInt(number);
  const buffer = Buffer.alloc(byteCount);
  for (let i = 0; i < byteCount; i++) {
    buffer[byteCount - 1 - i] = Number((value >> BigInt(i * 8)) & 0xffn);
  }
  return buffer;
}

function fromBuffer(buffer) {
  let value = 0n;
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8n) | BigInt(buffer[i]);
  }
  return Number(value);
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
