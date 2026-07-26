'use strict';

export default class RarityMap {
  constructor(torrent) {
    this.nPieces = torrent.info.pieces.length / 20;
    this.rarity = new Array(this.nPieces).fill(0);
    this.peerPieces = new Map();
  }

  addPeerPieces(peerId, pieces) {
    this.removePeer(peerId);
    const set = new Set();
    for (const piece of pieces) {
      if (piece >= 0 && piece < this.nPieces) {
        set.add(piece);
        this.rarity[piece]++;
      }
    }
    this.peerPieces.set(peerId, set);
  }

  havePiece(peerId, pieceIndex) {
    if (pieceIndex < 0 || pieceIndex >= this.nPieces) return;
    let set = this.peerPieces.get(peerId);
    if (!set) {
      set = new Set();
      this.peerPieces.set(peerId, set);
    }
    if (!set.has(pieceIndex)) {
      set.add(pieceIndex);
      this.rarity[pieceIndex]++;
    }
  }

  removePeer(peerId) {
    const set = this.peerPieces.get(peerId);
    if (!set) return;
    for (const piece of set) {
      if (piece >= 0 && piece < this.nPieces) {
        this.rarity[piece]--;
      }
    }
    this.peerPieces.delete(peerId);
  }

  getRarestPieces(pieceIndices) {
    return [...pieceIndices]
      .filter(i => i >= 0 && i < this.nPieces)
      .sort((a, b) => this.rarity[a] - this.rarity[b]);
  }
}
