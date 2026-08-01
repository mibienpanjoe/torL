'use strict';

import * as tp from './torrent-parser.js';
import * as state from './state.js';

export default class Pieces {
  constructor(torrent, completedBitfield = null) {
    function buildPiecesArray() {
      const nPieces = torrent.info.pieces.length / 20;
      const arr = new Array(nPieces).fill(null);
      return arr.map((_, i) => new Array(tp.blocksPerPiece(torrent, i)).fill(false));
    }

    this._requested = buildPiecesArray();
    this._received = buildPiecesArray();

    if (completedBitfield) {
      const nPieces = this._received.length;
      for (let i = 0; i < nPieces; i++) {
        if (state.hasBit(completedBitfield, i)) {
          const nBlocks = this._received[i].length;
          for (let j = 0; j < nBlocks; j++) {
            this._requested[i][j] = true;
            this._received[i][j] = true;
          }
        }
      }
    }
  }

  addRequested(pieceBlock) {
    const blockIndex = pieceBlock.begin / tp.BLOCK_LEN;
    this._requested[pieceBlock.index][blockIndex] = true;
  }

  addReceived(pieceBlock) {
    const blockIndex = pieceBlock.begin / tp.BLOCK_LEN;
    this._received[pieceBlock.index][blockIndex] = true;
  }

  releaseRequested(pieceBlock) {
    const blockIndex = pieceBlock.begin / tp.BLOCK_LEN;
    this._requested[pieceBlock.index][blockIndex] =
      this._received[pieceBlock.index][blockIndex];
  }

  needed(pieceBlock) {
    const blockIndex = pieceBlock.begin / tp.BLOCK_LEN;
    return !this._requested[pieceBlock.index][blockIndex];
  }

  isDone() {
    return this._received.every(blocks => blocks.every(i => i));
  }

  isPieceDone(index) {
    return this._received[index].every(b => b);
  }

  completedBitfield() {
    const nPieces = this._received.length;
    const bitfield = state.emptyBitfield(nPieces);
    for (let i = 0; i < nPieces; i++) {
      if (this.isPieceDone(i)) {
        state.setBit(bitfield, i);
      }
    }
    return bitfield;
  }
}
