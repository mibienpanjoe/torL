'use strict';

import * as tp from './torrent-parser.js';

export default class Queue {
  constructor(torrent, rarityMap, peerId) {
    this._torrent = torrent;
    this._rarityMap = rarityMap;
    this._peerId = peerId;
    this._pieces = new Set();
    this._orderedPieces = [];
    this._rarityRevision = -1;
    this.choked = true;
  }

  queue(pieceIndex) {
    if (pieceIndex < 0 || pieceIndex >= this._rarityMap.nPieces) return;
    if (!this._pieces.has(pieceIndex)) {
      this._pieces.add(pieceIndex);
      this._rarityMap.havePiece(this._peerId, pieceIndex);
    }
  }

  deque(pieces) {
    if (this._rarityRevision !== this._rarityMap.revision) {
      this._orderedPieces = this._rarityMap.getRarestPieces(this._pieces);
      this._rarityRevision = this._rarityMap.revision;
    }
    for (const pieceIndex of this._orderedPieces) {
      const nBlocks = tp.blocksPerPiece(this._torrent, pieceIndex);
      for (let i = 0; i < nBlocks; i++) {
        const block = {
          index: pieceIndex,
          begin: i * tp.BLOCK_LEN,
          length: tp.blockLen(this._torrent, pieceIndex, i)
        };
        if (pieces.needed(block)) {
          return block;
        }
      }
    }
    return null;
  }

  length() {
    return this._pieces.size;
  }
}
