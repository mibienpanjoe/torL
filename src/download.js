'use strict';

import fs from 'fs';
import path from 'path';
import net from 'net';
import * as tracker from './tracker.js';
import * as message from './message.js';
import * as state from './state.js';
import * as verify from './verify.js';
import Pieces from './Pieces.js';
import Queue from './Queue.js';
import RarityMap from './RarityMap.js';
import { DHTClient } from './dht.js';

export default function download(torrent, rootPath, options = {}) {
  const {
    maxConnections = 10,
    maxRetries = 3,
    retryDelay = 5000,
    log = () => {},
    announceInterval: overrideAnnounceInterval = null,
    useDHT = true,
    dhtBootstrapNodes = undefined,
    peers: injectedPeers = null,
    onProgress = () => {}
  } = options;

  return new Promise((resolve, reject) => {
    const trackerController = new AbortController();

    const peersPromise = injectedPeers
      ? Promise.resolve({ peers: injectedPeers, interval: null })
      : getPeers(torrent, useDHT, trackerController, dhtBootstrapNodes);

    peersPromise.then(({ peers, interval }) => {
      const savedBitfield = state.load(rootPath);
      const verifiedBitfield = verify.verifyPieces(torrent, rootPath, savedBitfield);
      const pieces = new Pieces(torrent, verifiedBitfield);

      if (pieces.isDone()) {
        state.save(rootPath, pieces.completedBitfield());
        resolve();
        return;
      }

      const rarityMap = new RarityMap(torrent);
      const pool = new PeerPool(torrent, pieces, rootPath, rarityMap, {
        maxConnections,
        maxRetries,
        retryDelay,
        log,
        onProgress,
        onComplete: resolve,
        onError: reject,
        trackerController
      });
      pool.addPeers(peers);
      pool.start();

      const ms = overrideAnnounceInterval !== null ? overrideAnnounceInterval : (interval && interval > 0 ? interval * 1000 : 0);
      if (ms > 0) {
        pool.scheduleAnnounce(ms, (done) => {
          tracker.getPeers(torrent, (newPeers) => done(newPeers), trackerController.signal);
        });
      }
    }).catch(reject);
  });
}

export function torrentSize(torrent) {
  if (torrent.info.files) {
    return torrent.info.files.reduce((sum, f) => sum + f.length, 0);
  }
  return torrent.info.length;
}

async function getPeers(torrent, useDHT, trackerController, dhtBootstrapNodes) {
  const hasTracker = torrent.announce && torrent.announce.length > 0;
  const trackerPromise = hasTracker
    ? new Promise((resolve) => {
        tracker.getPeers(torrent, (peers, interval) => {
          resolve({ peers, interval });
        }, trackerController.signal);
      })
    : Promise.resolve({ peers: [], interval: null });

  if (!useDHT) {
    return trackerPromise;
  }

  const dhtClient = new DHTClient(dhtBootstrapNodes ? { bootstrapNodes: dhtBootstrapNodes } : {});
  await dhtClient.start();
  const dhtPeers = await new Promise((resolve) => {
    dhtClient.findPeers(torrent, resolve);
  });
  dhtClient.stop();

  const trackerResult = await trackerPromise;
  const allPeers = [...trackerResult.peers];
  const seen = new Set(allPeers.map(p => `${p.ip}:${p.port}`));
  for (const peer of dhtPeers) {
    if (!seen.has(`${peer.ip}:${peer.port}`)) {
      allPeers.push(peer);
      seen.add(`${peer.ip}:${peer.port}`);
    }
  }
  return { peers: allPeers, interval: trackerResult.interval };
}

class PeerPool {
  constructor(torrent, pieces, rootPath, rarityMap, options) {
    this.torrent = torrent;
    this.pieces = pieces;
    this.rootPath = rootPath;
    this.rarityMap = rarityMap;
    this.maxConnections = options.maxConnections;
    this.maxRetries = options.maxRetries;
    this.retryDelay = options.retryDelay;
    this.log = options.log;
    this.onProgress = options.onProgress;
    this.onComplete = options.onComplete;
    this.onError = options.onError;
    this.trackerController = options.trackerController;
    this.totalSize = torrentSize(torrent);
    this.totalPieces = torrent.info.pieces.length / 20;

    this.availablePeers = [];
    this.activePeers = new Map();
    this.retryCounts = new Map();
    this.retryTimer = null;
    this.complete = false;
    this.announceTimeout = null;
  }

  scheduleAnnounce(ms, fetchPeers) {
    if (this.complete || this.announceTimeout) return;
    this.announceTimeout = setTimeout(() => {
      this.announceTimeout = null;
      if (this.complete) return;
      fetchPeers(newPeers => {
        if (this.complete) return;
        this.addPeers(newPeers);
        this.start();
        this.scheduleAnnounce(ms, fetchPeers);
      });
    }, ms);
  }

  addPeers(peers) {
    const activeIds = new Set(this.activePeers.keys());
    const availableIds = new Set(this.availablePeers.map(peerId));
    for (const peer of peers) {
      const id = peerId(peer);
      if (activeIds.has(id) || availableIds.has(id)) continue;
      this.retryCounts.set(id, this.retryCounts.get(id) || 0);
      this.availablePeers.push(peer);
      availableIds.add(id);
    }
  }

  start() {
    this._tryConnect();
  }

  _tryConnect() {
    if (this.complete) return;
    while (this.activePeers.size < this.maxConnections && this.availablePeers.length > 0) {
      const peer = this.availablePeers.shift();
      const id = peerId(peer);
      const retries = this.retryCounts.get(id);
      if (retries >= this.maxRetries) {
        this.log(`skipping peer ${id} after ${retries} retries`);
        continue;
      }
      this._connectPeer(peer);
    }
    this._checkProgress();
  }

  _connectPeer(peer) {
    const id = peerId(peer);
    this.retryCounts.set(id, this.retryCounts.get(id) + 1);
    const socket = new net.Socket();
    const queue = new Queue(this.torrent, this.rarityMap, id);
    this.activePeers.set(id, { socket, peer, queue });

    socket.on('error', err => {
      this.log(`peer ${id} error: ${err.message}`);
      this._handleDisconnect(id);
    });

    socket.on('close', () => {
      this._handleDisconnect(id);
    });

    socket.connect(peer.port, peer.ip, () => {
      socket.write(message.buildHandshake(this.torrent));
    });

    onWholeMsg(socket, msg => this._msgHandler(msg, id));
    this.onProgress({ type: 'peer', action: 'connected', peer: id });
    this._emitProgress();
  }

  _handleDisconnect(id) {
    const peer = this.activePeers.get(id);
    if (!peer) return;
    this.activePeers.delete(id);
    this.rarityMap.removePeer(id);
    try { peer.socket.end(); } catch (e) {}
    this.availablePeers.push(peer.peer);
    this._scheduleRetry(id);
    this._checkProgress();
    this.onProgress({ type: 'peer', action: 'disconnected', peer: id });
    this._emitProgress();
  }

  _emitProgress() {
    const completed = this.pieces.completedBitfield();
    let completedPieces = 0;
    for (let i = 0; i < this.totalPieces; i++) {
      const byte = completed[Math.floor(i / 8)];
      const bit = byte & (0x80 >> (i % 8));
      if (bit) completedPieces++;
    }
    const downloaded = completedPieces * this.torrent.info['piece length'];
    this.onProgress({
      type: 'progress',
      downloaded: Math.min(downloaded, this.totalSize),
      total: this.totalSize,
      percent: this.totalSize > 0 ? Math.min(downloaded, this.totalSize) / this.totalSize : 0,
      completedPieces,
      totalPieces: this.totalPieces,
      activePeers: this.activePeers.size,
      availablePeers: this.availablePeers.length
    });
  }

  _scheduleRetry(id) {
    if (this.retryTimer) return;
    const retries = this.retryCounts.get(id) || 0;
    const delay = Math.min(this.retryDelay * Math.pow(2, Math.max(0, retries - 1)), 30000);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this._tryConnect();
    }, delay);
  }

  _checkProgress() {
    if (this.complete) return;
    if (this.pieces.isDone()) {
      this._finish();
    } else if (this.activePeers.size === 0 && this.availablePeers.length === 0) {
      this._fail(new Error('All peers disconnected before download complete'));
    }
  }

  _finish() {
    if (this.complete) return;
    this.complete = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.announceTimeout) {
      clearTimeout(this.announceTimeout);
      this.announceTimeout = null;
    }
    if (this.trackerController) {
      this.trackerController.abort();
    }
    for (const { socket } of this.activePeers.values()) {
      try { socket.end(); } catch (e) {}
    }
    this.activePeers.clear();
    this.onComplete();
  }

  _fail(err) {
    if (this.complete) return;
    this.complete = true;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.announceTimeout) {
      clearTimeout(this.announceTimeout);
      this.announceTimeout = null;
    }
    if (this.trackerController) {
      this.trackerController.abort();
    }
    for (const { socket } of this.activePeers.values()) {
      try { socket.end(); } catch (e) {}
    }
    this.activePeers.clear();
    this.onError(err);
  }

  _msgHandler(msg, id) {
    const peer = this.activePeers.get(id);
    if (!peer) return;
    const { socket, queue } = peer;
    if (isHandshake(msg)) {
      socket.write(message.buildInterested());
    } else {
      const m = message.parse(msg);
      if (m.id === 0) chokeHandler(socket);
      if (m.id === 1) unchokeHandler(socket, this.torrent, this.pieces, queue, this.rootPath);
      if (m.id === 4) haveHandler(socket, this.torrent, this.pieces, queue, this.rootPath, m.payload);
      if (m.id === 5) bitfieldHandler(socket, this.torrent, this.pieces, queue, this.rootPath, m.payload);
      if (m.id === 7) pieceHandler(socket, this.torrent, this.pieces, queue, this.rootPath, m.payload, this._checkProgress.bind(this), this._emitProgress.bind(this));
    }
  }
}

function peerId(peer) {
  return `${peer.ip}:${peer.port}`;
}

function onWholeMsg(socket, callback) {
  let savedBuf = Buffer.alloc(0);
  let handshake = true;

  socket.on('data', recvBuf => {
    const msgLen = () => handshake ? savedBuf.readUInt8(0) + 49 : savedBuf.readInt32BE(0) + 4;
    savedBuf = Buffer.concat([savedBuf, recvBuf]);

    while (savedBuf.length >= 4 && savedBuf.length >= msgLen()) {
      callback(savedBuf.slice(0, msgLen()));
      savedBuf = savedBuf.slice(msgLen());
      handshake = false;
    }
  });
}

function isHandshake(msg) {
  return msg.length === msg.readUInt8(0) + 49 &&
         msg.toString('utf8', 1, 20) === 'BitTorrent protocol';
}

function chokeHandler(socket) {
  socket.end();
}

function unchokeHandler(socket, torrent, pieces, queue, rootPath) {
  queue.choked = false;
  requestPiece(socket, torrent, pieces, queue, rootPath);
}

function haveHandler(socket, torrent, pieces, queue, rootPath, payload) {
  const pieceIndex = payload.readUInt32BE(0);
  const queueEmpty = queue.length() === 0;
  queue.queue(pieceIndex);
  if (queueEmpty) requestPiece(socket, torrent, pieces, queue, rootPath);
}

function bitfieldHandler(socket, torrent, pieces, queue, rootPath, payload) {
  const queueEmpty = queue.length() === 0;
  payload.forEach((byte, i) => {
    let b = byte;
    for (let j = 0; j < 8; j++) {
      if (b % 2) queue.queue(i * 8 + 7 - j);
      b = Math.floor(b / 2);
    }
  });
  if (queueEmpty) requestPiece(socket, torrent, pieces, queue, rootPath);
}

function pieceHandler(socket, torrent, pieces, queue, rootPath, pieceResp, onProgress = () => {}, emitProgress = () => {}) {
  pieces.addReceived(pieceResp);

  const offset = pieceResp.index * torrent.info['piece length'] + pieceResp.begin;
  writeBlock(torrent, rootPath, pieceResp.block, offset);

  if (pieces.isPieceDone(pieceResp.index)) {
    state.save(rootPath, pieces.completedBitfield());
    emitProgress();
  }

  if (pieces.isDone()) {
    onProgress();
  } else {
    requestPiece(socket, torrent, pieces, queue, rootPath);
  }
}

function requestPiece(socket, torrent, pieces, queue, rootPath) {
  if (queue.choked) return null;

  const pieceBlock = queue.deque(pieces);
  if (pieceBlock) {
    socket.write(message.buildRequest(pieceBlock));
    pieces.addRequested(pieceBlock);
  }
}

function writeBlock(torrent, rootPath, block, offset) {
  const files = torrent.info.files
    ? torrent.info.files.map(f => ({
      length: f.length,
      path: path.join(rootPath, ...f.path.map(p => p.toString('utf8')))
    }))
    : [{
      length: torrent.info.length,
      path: rootPath
    }];

  let fileOffset = 0;
  for (const file of files) {
    const fileStart = fileOffset;
    const fileEnd = fileOffset + file.length;
    const blockStart = offset;
    const blockEnd = offset + block.length;

    if (blockEnd <= fileStart || blockStart >= fileEnd) {
      fileOffset += file.length;
      continue;
    }

    const overlapStart = Math.max(blockStart, fileStart);
    const overlapEnd = Math.min(blockEnd, fileEnd);
    const blockSliceStart = overlapStart - blockStart;
    const sliceLength = overlapEnd - overlapStart;
    const fileWriteOffset = overlapStart - fileStart;

    fs.mkdirSync(path.dirname(file.path), { recursive: true });
    const fd = fs.openSync(file.path, fs.existsSync(file.path) ? 'r+' : 'w');
    fs.writeSync(fd, block, blockSliceStart, sliceLength, fileWriteOffset);
    fs.closeSync(fd);

    fileOffset += file.length;
  }
}
