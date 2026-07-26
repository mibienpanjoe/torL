'use strict';

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import * as torrentParser from '../src/torrent-parser.js';
import * as verify from '../src/verify.js';
import * as state from '../src/state.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('verify', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-verify-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('verifies a complete single-file torrent', () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'resume.torrent'));
    const data = fs.readFileSync(path.join(__dirname, 'fixtures', 'resume.data'));
    const destPath = path.join(tmpDir, 'resume.txt');
    fs.writeFileSync(destPath, data);

    const bitfield = verify.verifyPieces(torrent, destPath);
    assert.ok(state.hasBit(bitfield, 0));
    assert.ok(state.hasBit(bitfield, 1));
  });

  it('does not verify a corrupted file', () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'resume.torrent'));
    const destPath = path.join(tmpDir, 'resume.txt');
    fs.writeFileSync(destPath, Buffer.alloc(32768, 'X'));

    const bitfield = verify.verifyPieces(torrent, destPath);
    assert.ok(!state.hasBit(bitfield, 0));
    assert.ok(!state.hasBit(bitfield, 1));
  });

  it('verifies only the first piece of a partial file', () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'resume.torrent'));
    const data = fs.readFileSync(path.join(__dirname, 'fixtures', 'resume.data'));
    const destPath = path.join(tmpDir, 'resume.txt');
    fs.writeFileSync(destPath, data.slice(0, 16384));

    const bitfield = verify.verifyPieces(torrent, destPath);
    assert.ok(state.hasBit(bitfield, 0));
    assert.ok(!state.hasBit(bitfield, 1));
  });

  it('verifies a complete multi-file torrent', () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'multi-file.torrent'));
    const destPath = path.join(tmpDir, 'test');
    fs.mkdirSync(destPath, { recursive: true });
    fs.writeFileSync(path.join(destPath, 'a.txt'), Buffer.from('Hello'));
    fs.writeFileSync(path.join(destPath, 'b.txt'), Buffer.from(' World!\n'));

    const bitfield = verify.verifyPieces(torrent, destPath);
    assert.ok(state.hasBit(bitfield, 0));
  });

  it('returns no completed pieces when the file is missing', () => {
    const torrent = torrentParser.open(path.join(__dirname, 'fixtures', 'resume.torrent'));
    const destPath = path.join(tmpDir, 'missing.txt');

    const bitfield = verify.verifyPieces(torrent, destPath);
    assert.ok(!state.hasBit(bitfield, 0));
    assert.ok(!state.hasBit(bitfield, 1));
  });
});
