'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import RarityMap from '../src/RarityMap.js';

function torrentFixture(nPieces) {
  return {
    info: {
      'piece length': 16384,
      pieces: Buffer.alloc(nPieces * 20),
      length: 16384 * nPieces
    }
  };
}

describe('RarityMap', () => {
  it('tracks how many peers have each piece', () => {
    const rarityMap = new RarityMap(torrentFixture(3));
    rarityMap.addPeerPieces('peer1', [0, 1]);
    rarityMap.addPeerPieces('peer2', [1, 2]);
    assert.strictEqual(rarityMap.rarity[0], 1);
    assert.strictEqual(rarityMap.rarity[1], 2);
    assert.strictEqual(rarityMap.rarity[2], 1);
  });

  it('updates rarity when a peer disconnects', () => {
    const rarityMap = new RarityMap(torrentFixture(3));
    rarityMap.addPeerPieces('peer1', [0, 1]);
    rarityMap.addPeerPieces('peer2', [1, 2]);
    rarityMap.removePeer('peer1');
    assert.strictEqual(rarityMap.rarity[0], 0);
    assert.strictEqual(rarityMap.rarity[1], 1);
    assert.strictEqual(rarityMap.rarity[2], 1);
  });

  it('handles have messages without an existing bitfield', () => {
    const rarityMap = new RarityMap(torrentFixture(3));
    rarityMap.havePiece('peer1', 0);
    rarityMap.havePiece('peer1', 0);
    assert.strictEqual(rarityMap.rarity[0], 1);
  });

  it('returns pieces ordered from rarest to most common', () => {
    const rarityMap = new RarityMap(torrentFixture(3));
    rarityMap.addPeerPieces('peer1', [0, 1, 2]);
    rarityMap.addPeerPieces('peer2', [0]);
    const ordered = rarityMap.getRarestPieces([0, 1, 2]);
    assert.deepStrictEqual(ordered, [1, 2, 0]);
  });
});
