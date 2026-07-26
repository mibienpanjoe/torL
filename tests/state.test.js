'use strict';

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import os from 'os';
import path from 'path';
import * as state from '../src/state.js';

describe('state', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'torl-state-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saves and loads a bitfield', () => {
    const rootPath = path.join(tmpDir, 'download');
    const bitfield = state.emptyBitfield(10);
    state.setBit(bitfield, 0);
    state.setBit(bitfield, 5);
    state.setBit(bitfield, 9);

    state.save(rootPath, bitfield);
    const loaded = state.load(rootPath);

    assert.ok(Buffer.isBuffer(loaded));
    assert.ok(state.hasBit(loaded, 0));
    assert.ok(state.hasBit(loaded, 5));
    assert.ok(state.hasBit(loaded, 9));
    assert.ok(!state.hasBit(loaded, 1));
  });

  it('returns null when no state file exists', () => {
    const rootPath = path.join(tmpDir, 'missing');
    assert.strictEqual(state.load(rootPath), null);
  });

  it('returns null for invalid state content', () => {
    const rootPath = path.join(tmpDir, 'download');
    fs.writeFileSync(rootPath + '.torl.state', 'not-json');
    assert.strictEqual(state.load(rootPath), null);
  });
});
