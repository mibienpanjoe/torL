'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import * as message from '../src/message.js';
import * as torrentParser from '../src/torrent-parser.js';

const INFO_HASH = Buffer.alloc(20);
const PEER_ID = Buffer.alloc(20);

describe('message', () => {
  it('builds a handshake', () => {
    const torrent = { info: { pieces: INFO_HASH } };
    const handshake = message.buildHandshake(torrent);
    assert.strictEqual(handshake.length, 68);
    assert.strictEqual(handshake.readUInt8(0), 19);
    assert.strictEqual(handshake.toString('utf8', 1, 20), 'BitTorrent protocol');
    assert.deepStrictEqual(handshake.slice(28, 48), torrentParser.infoHash(torrent));
    assert.strictEqual(handshake.slice(48, 68).length, 20);
  });

  it('builds a keep-alive message', () => {
    const msg = message.buildKeepAlive();
    assert.strictEqual(msg.length, 4);
    assert.strictEqual(msg.readUInt32BE(0), 0);
  });

  it('builds an interested message', () => {
    const msg = message.buildInterested();
    assert.strictEqual(msg.length, 5);
    assert.strictEqual(msg.readUInt32BE(0), 1);
    assert.strictEqual(msg.readUInt8(4), 2);
  });

  it('builds and parses a request message', () => {
    const request = message.buildRequest({ index: 1, begin: 2, length: 16384 });
    const parsed = message.parse(request);
    assert.strictEqual(parsed.id, 6);
    assert.strictEqual(parsed.payload.index, 1);
    assert.strictEqual(parsed.payload.begin, 2);
    assert.strictEqual(parsed.payload.length, 16384);
  });

  it('builds and parses a piece message', () => {
    const block = Buffer.from('hello world');
    const piece = message.buildPiece({ index: 0, begin: 0, block });
    const parsed = message.parse(piece);
    assert.strictEqual(parsed.id, 7);
    assert.strictEqual(parsed.payload.index, 0);
    assert.strictEqual(parsed.payload.begin, 0);
    assert.deepStrictEqual(parsed.payload.block, block);
  });

  it('builds and parses a bitfield message', () => {
    const bitfield = Buffer.from([0b11000000]);
    const msg = message.buildBitfield(bitfield);
    assert.strictEqual(msg.readUInt32BE(0), 2);
    assert.strictEqual(msg.readUInt8(4), 5);
    assert.deepStrictEqual(msg.slice(5), bitfield);
  });

  it('sets the extension protocol bit in the handshake', () => {
    const torrent = { info: { pieces: INFO_HASH } };
    const handshake = message.buildHandshake(torrent);
    assert.strictEqual(handshake.readUInt8(25) & 0x10, 0x10);
    assert.strictEqual(handshake.readUInt8(20), 0);
  });

  it('builds and parses an extended handshake', () => {
    const ext = message.buildExtHandshake(1234, 6881);
    const parsed = message.parse(ext);
    assert.strictEqual(parsed.id, 20);
    assert.strictEqual(parsed.extId, 0);
    const handshake = message.parseExtHandshake(ext);
    assert.strictEqual(handshake.utMetadata, 1);
    assert.strictEqual(handshake.metadataSize, 1234);
    assert.strictEqual(handshake.listenPort, 6881);
  });

  it('builds and parses a metadata request', () => {
    const request = message.buildMetadataRequest(2);
    const parsed = message.parse(request);
    assert.strictEqual(parsed.id, 20);
    assert.strictEqual(parsed.extId, 1);
    const meta = message.parseMetadataMessage(request);
    assert.strictEqual(meta.msgType, 0);
    assert.strictEqual(meta.piece, 2);
  });

  it('builds and parses a metadata data message', () => {
    const metadata = Buffer.from('bencoded info dictionary');
    const data = message.buildMetadataData(0, metadata);
    const parsed = message.parse(data);
    assert.strictEqual(parsed.id, 20);
    const meta = message.parseMetadataMessage(data);
    assert.strictEqual(meta.msgType, 1);
    assert.strictEqual(meta.piece, 0);
    assert.strictEqual(meta.totalSize, metadata.length);
    assert.deepStrictEqual(meta.data, metadata);
  });
});
