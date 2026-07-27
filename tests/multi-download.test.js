'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { downloadAll } from '../src/cli.js';

describe('multi-download', () => {
  it('downloads multiple inputs sequentially by default', async () => {
    const order = [];
    const downloadOneFn = async (input, options) => {
      order.push(input);
      return `/tmp/${input}`;
    };

    const results = await downloadAll(['a.torrent', 'b.torrent', 'c.torrent'], { concurrency: 1 }, null, downloadOneFn);

    assert.strictEqual(results.length, 3);
    assert.ok(results.every(r => r.success));
    assert.deepStrictEqual(order, ['a.torrent', 'b.torrent', 'c.torrent']);
  });

  it('downloads multiple inputs concurrently with --concurrency', async () => {
    const active = [];
    const maxActive = { value: 0 };
    const downloadOneFn = async (input, options) => {
      active.push(input);
      maxActive.value = Math.max(maxActive.value, active.length);
      await new Promise(r => setTimeout(r, 10));
      const idx = active.indexOf(input);
      active.splice(idx, 1);
      return `/tmp/${input}`;
    };

    const results = await downloadAll(['a.torrent', 'b.torrent', 'c.torrent', 'd.torrent'], { concurrency: 2 }, null, downloadOneFn);

    assert.strictEqual(results.length, 4);
    assert.ok(results.every(r => r.success));
    assert.strictEqual(maxActive.value, 2);
  });

  it('collects failures without stopping others', async () => {
    const downloadOneFn = async (input) => {
      if (input === 'b.torrent') {
        throw new Error('failed');
      }
      return `/tmp/${input}`;
    };

    const results = await downloadAll(['a.torrent', 'b.torrent', 'c.torrent'], { concurrency: 1 }, null, downloadOneFn);

    assert.strictEqual(results.length, 3);
    assert.strictEqual(results.filter(r => r.success).length, 2);
    assert.strictEqual(results.filter(r => !r.success).length, 1);
    assert.ok(results[1].error.message.includes('failed'));
  });
});
