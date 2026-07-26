'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as tp from '../src/torrent-parser.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function fixture(name) {
  return path.join(__dirname, 'fixtures', name);
}

describe('torrent-parser', () => {
  it('opens a single-file torrent', () => {
    const torrent = tp.open(fixture('single-file.torrent'));
    assert.strictEqual(torrent.info.name.toString('utf8'), 'test.txt');
    assert.strictEqual(torrent.info.length, 13);
    assert.strictEqual(torrent.announce.toString('utf8'), 'udp://tracker.example.com:6969');
  });

  it('opens a multi-file torrent', () => {
    const torrent = tp.open(fixture('multi-file.torrent'));
    assert.strictEqual(torrent.info.name.toString('utf8'), 'test');
    assert.ok(Array.isArray(torrent.info.files));
    assert.strictEqual(torrent.info.files.length, 2);
    assert.strictEqual(torrent.info.files[0].length, 5);
    assert.strictEqual(torrent.info.files[1].length, 8);
  });

  it('computes size buffer for single-file torrent', () => {
    const torrent = tp.open(fixture('single-file.torrent'));
    const size = tp.size(torrent);
    assert.strictEqual(size.length, 8);
    assert.strictEqual(size.readBigUInt64BE(), 13n);
  });

  it('computes size buffer for multi-file torrent', () => {
    const torrent = tp.open(fixture('multi-file.torrent'));
    const size = tp.size(torrent);
    assert.strictEqual(size.length, 8);
    assert.strictEqual(size.readBigUInt64BE(), 13n);
  });

  it('computes infoHash', () => {
    const torrent = tp.open(fixture('single-file.torrent'));
    const hash = tp.infoHash(torrent);
    assert.strictEqual(hash.length, 20);
  });

  it('computes piece length for single-file torrent', () => {
    const torrent = tp.open(fixture('single-file.torrent'));
    assert.strictEqual(tp.pieceLen(torrent, 0), 13);
  });

  it('computes block length for single-file torrent', () => {
    const torrent = tp.open(fixture('single-file.torrent'));
    assert.strictEqual(tp.blockLen(torrent, 0, 0), 13);
  });

  it('computes blocks per piece for single-file torrent', () => {
    const torrent = tp.open(fixture('single-file.torrent'));
    assert.strictEqual(tp.blocksPerPiece(torrent, 0), 1);
  });
});
