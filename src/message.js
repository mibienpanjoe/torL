'use strict';

import { Buffer } from 'buffer';
import bencode from 'bencode';
import * as torrentParser from './torrent-parser.js';
import * as util from './util.js';

export function buildHandshake(torrent) {
  return buildHandshakeFromInfoHash(torrentParser.infoHash(torrent));
}

export function buildHandshakeFromInfoHash(infoHash) {
  const buf = Buffer.alloc(68);
  // pstrlen
  buf.writeUInt8(19, 0);
  // pstr
  buf.write('BitTorrent protocol', 1);
  // reserved
  // enable extension protocol (BEP 10): set bit 0x10 in the first reserved byte
  buf.writeUInt32BE(0x10000000, 20);
  buf.writeUInt32BE(0, 24);
  // info hash
  infoHash.copy(buf, 28);
  // peer id
  util.genId().copy(buf, 28 + 20);
  return buf;
}

export function buildKeepAlive() {
  return Buffer.alloc(4);
}

export function buildChoke() {
  const buf = Buffer.alloc(5);
  // length
  buf.writeUInt32BE(1, 0);
  // id
  buf.writeUInt8(0, 4);
  return buf;
}

export function buildUnchoke() {
  const buf = Buffer.alloc(5);
  // length
  buf.writeUInt32BE(1, 0);
  // id
  buf.writeUInt8(1, 4);
  return buf;
}

export function buildInterested() {
  const buf = Buffer.alloc(5);
  // length
  buf.writeUInt32BE(1, 0);
  // id
  buf.writeUInt8(2, 4);
  return buf;
}

export function buildUninterested() {
  const buf = Buffer.alloc(5);
  // length
  buf.writeUInt32BE(1, 0);
  // id
  buf.writeUInt8(3, 4);
  return buf;
}

export function buildHave(payload) {
  const buf = Buffer.alloc(9);
  // length
  buf.writeUInt32BE(5, 0);
  // id
  buf.writeUInt8(4, 4);
  // piece index
  buf.writeUInt32BE(payload, 5);
  return buf;
}

export function buildBitfield(bitfield) {
  const buf = Buffer.alloc(5 + bitfield.length);
  // length
  buf.writeUInt32BE(bitfield.length + 1, 0);
  // id
  buf.writeUInt8(5, 4);
  // bitfield
  bitfield.copy(buf, 5);
  return buf;
}

export function buildRequest(payload) {
  const buf = Buffer.alloc(17);
  // length
  buf.writeUInt32BE(13, 0);
  // id
  buf.writeUInt8(6, 4);
  // piece index
  buf.writeUInt32BE(payload.index, 5);
  // begin
  buf.writeUInt32BE(payload.begin, 9);
  // length
  buf.writeUInt32BE(payload.length, 13);
  return buf;
}

export function buildPiece(payload) {
  const buf = Buffer.alloc(payload.block.length + 13);
  // length
  buf.writeUInt32BE(payload.block.length + 9, 0);
  // id
  buf.writeUInt8(7, 4);
  // piece index
  buf.writeUInt32BE(payload.index, 5);
  // begin
  buf.writeUInt32BE(payload.begin, 9);
  // block
  payload.block.copy(buf, 13);
  return buf;
}

export function buildCancel(payload) {
  const buf = Buffer.alloc(17);
  // length
  buf.writeUInt32BE(13, 0);
  // id
  buf.writeUInt8(8, 4);
  // piece index
  buf.writeUInt32BE(payload.index, 5);
  // begin
  buf.writeUInt32BE(payload.begin, 9);
  // length
  buf.writeUInt32BE(payload.length, 13);
  return buf;
}

export function buildPort(payload) {
  const buf = Buffer.alloc(7);
  // length
  buf.writeUInt32BE(3, 0);
  // id
  buf.writeUInt8(9, 4);
  // listen-port
  buf.writeUInt16BE(payload, 5);
  return buf;
}

export function parse(msg) {
  const id = msg.length > 4 ? msg.readInt8(4) : null;
  let payload = msg.length > 5 ? msg.slice(5) : null;
  let extId = null;
  if (id === 6 || id === 7 || id === 8) {
    const rest = payload.slice(8);
    payload = {
      index: payload.readInt32BE(0),
      begin: payload.readInt32BE(4)
    };
    if (id === 7) {
      payload.block = rest;
    } else {
      payload.length = rest.readUInt32BE(0);
    }
  } else if (id === 20) {
    extId = msg.readUInt8(5);
    payload = msg.slice(6);
  }

  return {
    size: msg.readInt32BE(0),
    id: id,
    extId: extId,
    payload: payload
  };
}

// --- BEP 10 Extension Protocol ---

export function buildExtHandshake(metadataSize, listenPort) {
  const dict = {
    m: { ut_metadata: 1 }
  };
  if (metadataSize !== undefined) {
    dict.metadata_size = metadataSize;
  }
  if (listenPort !== undefined) {
    dict.p = listenPort;
  }
  const payload = Buffer.from(bencode.encode(dict));
  const buf = Buffer.alloc(6 + payload.length);
  buf.writeUInt32BE(2 + payload.length, 0);
  buf.writeUInt8(20, 4); // extended message id
  buf.writeUInt8(0, 5); // extended handshake message id
  payload.copy(buf, 6);
  return buf;
}

export function buildMetadataRequest(piece, extId = 1) {
  const dict = Buffer.from(bencode.encode({ msg_type: 0, piece }));
  const buf = Buffer.alloc(6 + dict.length);
  buf.writeUInt32BE(2 + dict.length, 0);
  buf.writeUInt8(20, 4);
  buf.writeUInt8(extId, 5);
  dict.copy(buf, 6);
  return buf;
}

export function buildMetadataReject(piece, extId = 1) {
  const dict = Buffer.from(bencode.encode({ msg_type: 2, piece }));
  const buf = Buffer.alloc(6 + dict.length);
  buf.writeUInt32BE(2 + dict.length, 0);
  buf.writeUInt8(20, 4);
  buf.writeUInt8(extId, 5);
  dict.copy(buf, 6);
  return buf;
}

export function buildMetadataData(piece, metadata, extId = 1) {
  const dict = Buffer.from(bencode.encode({ msg_type: 1, piece, total_size: metadata.length }));
  const buf = Buffer.alloc(6 + dict.length + metadata.length);
  buf.writeUInt32BE(2 + dict.length + metadata.length, 0);
  buf.writeUInt8(20, 4);
  buf.writeUInt8(extId, 5);
  dict.copy(buf, 6);
  metadata.copy(buf, 6 + dict.length);
  return buf;
}

export function parseExtHandshake(msg) {
  const extId = msg.readUInt8(5);
  if (extId !== 0) return null;
  const dict = bencode.decode(msg.slice(6));
  const m = dict.m || {};
  const utMetadata = m['ut_metadata'];
  return {
    extId: 0,
    utMetadata: typeof utMetadata === 'number' ? utMetadata : null,
    metadataSize: dict.metadata_size,
    listenPort: dict.p
  };
}

export function parseMetadataMessage(msg) {
  const extId = msg.readUInt8(5);
  const dict = bencode.decode(msg.slice(6));
  const dictLen = Buffer.from(bencode.encode(dict)).length;
  const msgType = dict.msg_type;
  const piece = dict.piece;
  const totalSize = dict.total_size;
  const data = msgType === 1 ? msg.slice(6 + dictLen) : null;
  return {
    extId,
    msgType,
    piece,
    totalSize,
    data
  };
}
