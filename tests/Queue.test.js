'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import Queue from '../src/Queue.js';
import RarityMap from '../src/RarityMap.js';

function torrentFixture(pieceLength, nPieces) {
  return {
    info: {
      'piece length': pieceLength,
      pieces: Buffer.alloc(nPieces * 20),
      length: pieceLength * nPieces
    }
  };
}

function piecesFixture(torrent) {
  const nPieces = torrent.info.pieces.length / 20;
  const lastPieceLength = torrent.info.length % torrent.info['piece length'] || torrent.info['piece length'];
  const lastPieceIndex = Math.floor(torrent.info.length / torrent.info['piece length']);
  return {
    _requested: new Array(nPieces).fill(null).map((_, i) => {
      const pieceLength = i === lastPieceIndex ? lastPieceLength : torrent.info['piece length'];
      const nBlocks = Math.ceil(pieceLength / 16384);
      return new Array(nBlocks).fill(false);
    }),
    _received: new Array(nPieces).fill(null).map((_, i) => {
      const pieceLength = i === lastPieceIndex ? lastPieceLength : torrent.info['piece length'];
      const nBlocks = Math.ceil(pieceLength / 16384);
      return new Array(nBlocks).fill(false);
    }),
    needed({ index, begin }) {
      return !this._requested[index][begin / 16384];
    },
    addRequested({ index, begin }) {
      this._requested[index][begin / 16384] = true;
    }
  };
}

describe('Queue', () => {
  it('queues a piece and returns its first block', () => {
    const torrent = torrentFixture(16384, 1);
    const rarityMap = new RarityMap(torrent);
    const queue = new Queue(torrent, rarityMap, 'peer1');
    const pieces = piecesFixture(torrent);
    queue.queue(0);
    assert.strictEqual(queue.length(), 1);
    const block = queue.deque(pieces);
    assert.strictEqual(block.index, 0);
    assert.strictEqual(block.begin, 0);
    assert.strictEqual(block.length, 16384);
  });

  it('queues a piece and returns multiple blocks for a large piece', () => {
    const torrent = torrentFixture(32768, 1);
    const rarityMap = new RarityMap(torrent);
    const queue = new Queue(torrent, rarityMap, 'peer1');
    const pieces = piecesFixture(torrent);
    queue.queue(0);
    assert.strictEqual(queue.length(), 1);
    const first = queue.deque(pieces);
    pieces.addRequested(first);
    const second = queue.deque(pieces);
    assert.strictEqual(first.begin, 0);
    assert.strictEqual(second.begin, 16384);
  });

  it('starts choked', () => {
    const torrent = torrentFixture(16384, 1);
    const rarityMap = new RarityMap(torrent);
    const queue = new Queue(torrent, rarityMap, 'peer1');
    assert.ok(queue.choked);
  });

  it('orders pieces by rarity', () => {
    const torrent = torrentFixture(16384, 2);
    const rarityMap = new RarityMap(torrent);
    const queue1 = new Queue(torrent, rarityMap, 'peer1');
    const queue2 = new Queue(torrent, rarityMap, 'peer2');
    const pieces = piecesFixture(torrent);

    // peer1 has pieces 0 and 1, peer2 has piece 0
    queue1.queue(0);
    queue1.queue(1);
    queue2.queue(0);

    // rarity: piece 0 -> 2, piece 1 -> 1
    // peer1's queue should prefer the rarest piece it has: piece 1
    const block = queue1.deque(pieces);
    assert.strictEqual(block.index, 1);
  });

  it('skips pieces that are no longer needed', () => {
    const torrent = torrentFixture(16384, 2);
    const rarityMap = new RarityMap(torrent);
    const queue = new Queue(torrent, rarityMap, 'peer1');
    const pieces = piecesFixture(torrent);
    queue.queue(0);
    queue.queue(1);
    pieces._requested[0][0] = true;
    const block = queue.deque(pieces);
    assert.strictEqual(block.index, 1);
  });

  it('reuses the rarest-first order until availability changes', () => {
    const torrent = torrentFixture(16384, 2);
    const rarityMap = new RarityMap(torrent);
    const queue = new Queue(torrent, rarityMap, 'peer1');
    const pieces = piecesFixture(torrent);
    queue.queue(0);
    queue.queue(1);

    const getRarestPieces = rarityMap.getRarestPieces.bind(rarityMap);
    let sortCount = 0;
    rarityMap.getRarestPieces = pieceIndices => {
      sortCount++;
      return getRarestPieces(pieceIndices);
    };

    const first = queue.deque(pieces);
    pieces.addRequested(first);
    queue.deque(pieces);
    assert.strictEqual(sortCount, 1);

    rarityMap.havePiece('peer2', 0);
    queue.deque(pieces);
    assert.strictEqual(sortCount, 2);
  });
});
