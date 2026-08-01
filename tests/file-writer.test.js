'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import FileWriter from '../src/file-writer.js';

describe('FileWriter', () => {
  it('writes repeated blocks to a single open file', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-writer-'));
    const destPath = path.join(tmpDir, 'payload.bin');
    const torrent = { info: { length: 6 } };
    const writer = new FileWriter(torrent, destPath);

    try {
      writer.write(Buffer.from('abc'), 0);
      writer.write(Buffer.from('def'), 3);
      writer.close();
      assert.deepStrictEqual(fs.readFileSync(destPath), Buffer.from('abcdef'));
    } finally {
      writer.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });

  it('splits a block across multi-file boundaries', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-writer-'));
    const torrent = {
      info: {
        files: [
          { length: 3, path: [Buffer.from('a.bin')] },
          { length: 3, path: [Buffer.from('nested'), Buffer.from('b.bin')] }
        ]
      }
    };
    const writer = new FileWriter(torrent, tmpDir);

    try {
      writer.write(Buffer.from('abcdef'), 0);
      writer.close();
      assert.deepStrictEqual(fs.readFileSync(path.join(tmpDir, 'a.bin')), Buffer.from('abc'));
      assert.deepStrictEqual(fs.readFileSync(path.join(tmpDir, 'nested', 'b.bin')), Buffer.from('def'));
    } finally {
      writer.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
  });
});
