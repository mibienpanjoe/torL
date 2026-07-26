'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import Queue from '../src/Queue.js';

function torrentFixture(pieceLength, nPieces) {
  return {
    info: {
      'piece length': pieceLength,
      pieces: Buffer.alloc(nPieces * 20),
      length: pieceLength * nPieces
    }
  };
}

describe('Queue', () => {
  it('queues blocks for a piece', () => {
    const queue = new Queue(torrentFixture(16384, 1));
    queue.queue(0);
    assert.strictEqual(queue.length(), 1);
    const block = queue.deque();
    assert.strictEqual(block.index, 0);
    assert.strictEqual(block.begin, 0);
    assert.strictEqual(block.length, 16384);
  });

  it('queues multiple blocks for a large piece', () => {
    const queue = new Queue(torrentFixture(32768, 1));
    queue.queue(0);
    assert.strictEqual(queue.length(), 2);
    const first = queue.deque();
    const second = queue.deque();
    assert.strictEqual(first.begin, 0);
    assert.strictEqual(second.begin, 16384);
  });

  it('reports peek value', () => {
    const queue = new Queue(torrentFixture(16384, 1));
    queue.queue(0);
    const peeked = queue.peek();
    assert.strictEqual(peeked.index, 0);
    assert.strictEqual(queue.length(), 1);
  });

  it('starts choked', () => {
    const queue = new Queue(torrentFixture(16384, 1));
    assert.ok(queue.choked);
  });
});
