'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import Pieces from '../src/Pieces.js';

function torrentFixture(pieceLength, nPieces) {
  return {
    info: {
      'piece length': pieceLength,
      pieces: Buffer.alloc(nPieces * 20),
      length: pieceLength * nPieces
    }
  };
}

describe('Pieces', () => {
  it('tracks requested blocks', () => {
    const pieces = new Pieces(torrentFixture(32768, 1)); // 2 blocks
    pieces.addRequested({ index: 0, begin: 0 });
    assert.ok(pieces.needed({ index: 0, begin: 16384 }));
    assert.ok(!pieces.needed({ index: 0, begin: 0 }));
  });

  it('detects completion', () => {
    const pieces = new Pieces(torrentFixture(16384, 1));
    assert.ok(!pieces.isDone());
    pieces.addReceived({ index: 0, begin: 0 });
    assert.ok(pieces.isDone());
  });

  it('handles multiple blocks per piece', () => {
    const pieces = new Pieces(torrentFixture(32768, 1));
    pieces.addReceived({ index: 0, begin: 0 });
    assert.ok(!pieces.isDone());
    pieces.addReceived({ index: 0, begin: 16384 });
    assert.ok(pieces.isDone());
  });

  it('allows re-requesting a block after its owner releases it', () => {
    const pieces = new Pieces(torrentFixture(16384, 1));
    const block = { index: 0, begin: 0 };
    pieces.addRequested(block);
    assert.ok(!pieces.needed(block));

    pieces.releaseRequested(block);
    assert.ok(pieces.needed(block));
  });
});
