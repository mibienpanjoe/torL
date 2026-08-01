'use strict';

import net from 'net';
import * as tracker from './tracker.js';
import * as message from './message.js';
import * as state from './state.js';
import * as verify from './verify.js';
import Pieces from './Pieces.js';
import Queue from './Queue.js';
import RarityMap from './RarityMap.js';
import FileWriter from './file-writer.js';
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
    initialPeers = null,
    onProgress = () => {},
    signal = undefined,
    saveInterval = 30000,
    requestPipeline = 16,
    requestTimeout = 15000
  } = options;

  return new Promise((resolve, reject) => {
    const trackerController = new AbortController();
    const shutdownController = new AbortController();

    const hasInitialPeers = !injectedPeers && Array.isArray(initialPeers) && initialPeers.length > 0;
    let peersPromise;
    if (injectedPeers) {
      peersPromise = Promise.resolve({ peers: injectedPeers, interval: null });
    } else if (hasInitialPeers) {
      peersPromise = Promise.resolve({ peers: initialPeers, interval: null });
    } else {
      peersPromise = getPeers(torrent, useDHT, trackerController, dhtBootstrapNodes);
    }

    if (signal) {
      signal.addEventListener('abort', () => {
        shutdownController.abort();
        trackerController.abort();
      }, { once: true });
    }

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
        trackerController,
        shutdownController,
        saveInterval,
        requestPipeline,
        requestTimeout
      });
      pool.addPeers(peers);
      pool.start();

      let ms = interval && interval > 0 ? interval * 1000 : 0;
      if (hasInitialPeers) ms = 30000;
      if (overrideAnnounceInterval !== null) ms = overrideAnnounceInterval;
      if (ms > 0) {
        pool.scheduleAnnounce(ms, (done) => {
          if (hasInitialPeers && (!torrent.announce || torrent.announce.length === 0)) {
            getPeers(torrent, useDHT, trackerController, dhtBootstrapNodes)
              .then(({ peers }) => done(peers))
              .catch(() => done([]));
          } else {
            tracker.getPeers(torrent, (newPeers) => done(newPeers), trackerController.signal);
          }
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

  const dhtLookup = startDhtLookup(torrent, dhtBootstrapNodes);
  const first = await Promise.race([
    trackerPromise.then(result => ({ source: 'tracker', ...result })),
    dhtLookup.promise.then(peers => ({ source: 'dht', peers, interval: null }))
  ]);

  if (first.peers.length > 0) {
    if (first.source === 'tracker') dhtLookup.cancel();
    return { peers: first.peers, interval: first.interval };
  }

  if (first.source === 'tracker') {
    return { peers: await dhtLookup.promise, interval: null };
  }
  return trackerPromise;
}

function startDhtLookup(torrent, dhtBootstrapNodes) {
  const dhtClient = new DHTClient(dhtBootstrapNodes ? { bootstrapNodes: dhtBootstrapNodes } : {});
  let settled = false;
  let finish;
  const promise = new Promise(resolve => {
    finish = (peers = []) => {
      if (settled) return;
      settled = true;
      dhtClient.stop();
      resolve(peers);
    };

    dhtClient.start()
      .then(() => {
        if (settled) {
          dhtClient.stop();
          return;
        }
        return dhtClient.findPeers(torrent, finish);
      })
      .catch(() => finish());
  });

  return { promise, cancel: () => finish() };
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
    this.shutdownController = options.shutdownController;
    this.totalSize = torrentSize(torrent);
    this.totalPieces = torrent.info.pieces.length / 20;
    this.requestPipeline = Number.isFinite(options.requestPipeline)
      ? Math.max(1, Math.floor(options.requestPipeline))
      : 16;
    this.requestTimeout = Number.isFinite(options.requestTimeout)
      ? Math.max(0, Math.floor(options.requestTimeout))
      : 15000;
    this.writer = new FileWriter(torrent, rootPath);

    this.availablePeers = [];
    this.activePeers = new Map();
    this.retryCounts = new Map();
    this.retryTimer = null;
    this.complete = false;
    this.announceTimeout = null;
    this.saveTimer = null;

    if (options.saveInterval > 0) {
      this.saveTimer = setInterval(() => {
        if (!this.complete) {
          state.save(this.rootPath, this.pieces.completedBitfield());
        }
      }, options.saveInterval);
    }

    if (this.shutdownController) {
      this.shutdownController.signal.addEventListener('abort', () => {
        this._shutdown();
      }, { once: true });
    }
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
    this.activePeers.set(id, {
      id,
      socket,
      peer,
      queue,
      outstanding: new Map(),
      requestTimer: null
    });

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
    this._releaseOutstanding(peer);
    this.activePeers.delete(id);
    this.rarityMap.removePeer(id);
    try { peer.socket.end(); } catch (e) {}
    this.availablePeers.push(peer.peer);
    this._scheduleRetry(id);
    for (const activePeer of this.activePeers.values()) {
      this._fillPipeline(activePeer);
    }
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
    this._clearTimers();
    if (this.trackerController) {
      this.trackerController.abort();
    }
    for (const peer of this.activePeers.values()) {
      this._clearRequestTimer(peer);
      const { socket } = peer;
      try { socket.end(); } catch (e) {}
    }
    this.activePeers.clear();
    try {
      this.writer.close();
      state.save(this.rootPath, this.pieces.completedBitfield());
      this.onComplete();
    } catch (err) {
      this.onError(err);
    }
  }

  _clearTimers() {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.announceTimeout) {
      clearTimeout(this.announceTimeout);
      this.announceTimeout = null;
    }
    if (this.saveTimer) {
      clearInterval(this.saveTimer);
      this.saveTimer = null;
    }
  }

  _shutdown() {
    if (this.complete) return;
    this.complete = true;
    this._clearTimers();
    for (const peer of this.activePeers.values()) {
      this._clearRequestTimer(peer);
      const { socket } = peer;
      try { socket.end(); } catch (e) {}
    }
    this.activePeers.clear();
    try {
      this.writer.close();
      state.save(this.rootPath, this.pieces.completedBitfield());
      this.onComplete();
    } catch (err) {
      this.onError(err);
    }
  }

  _fail(err) {
    if (this.complete) return;
    this.complete = true;
    this._clearTimers();
    if (this.trackerController) {
      this.trackerController.abort();
    }
    for (const peer of this.activePeers.values()) {
      this._clearRequestTimer(peer);
      const { socket } = peer;
      try { socket.end(); } catch (e) {}
    }
    this.activePeers.clear();
    try { this.writer.close(); } catch (e) {}
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
      if (m.id === 0) {
        queue.choked = true;
        this._releaseOutstanding(peer);
        for (const activePeer of this.activePeers.values()) {
          if (activePeer !== peer) this._fillPipeline(activePeer);
        }
      }
      if (m.id === 1) {
        queue.choked = false;
        this._fillPipeline(peer);
      }
      if (m.id === 4) {
        queue.queue(m.payload.readUInt32BE(0));
        this._fillPipeline(peer);
      }
      if (m.id === 5) {
        m.payload.forEach((byte, i) => {
          for (let bit = 0; bit < 8; bit++) {
            if (byte & (0x80 >> bit)) queue.queue(i * 8 + bit);
          }
        });
        this._fillPipeline(peer);
      }
      if (m.id === 7) this._handlePiece(peer, m.payload);
    }
  }

  _handlePiece(peer, pieceResp) {
    const key = blockKey(pieceResp);
    const requested = peer.outstanding.get(key);
    if (!requested) return;
    if (pieceResp.block.length !== requested.pieceBlock.length) {
      this._handleDisconnect(peer.id);
      return;
    }
    peer.outstanding.delete(key);

    this.pieces.addReceived(pieceResp);
    const offset = pieceResp.index * this.torrent.info['piece length'] + pieceResp.begin;
    try {
      this.writer.write(pieceResp.block, offset);
    } catch (err) {
      this._fail(err);
      return;
    }

    if (this.pieces.isPieceDone(pieceResp.index)) {
      this._emitProgress();
    }

    this._checkProgress();
    if (!this.complete) this._fillPipeline(peer);
  }

  _fillPipeline(peer) {
    if (this.complete || peer.queue.choked) return;

    while (peer.outstanding.size < this.requestPipeline) {
      const pieceBlock = peer.queue.deque(this.pieces);
      if (!pieceBlock) break;
      peer.socket.write(message.buildRequest(pieceBlock));
      this.pieces.addRequested(pieceBlock);
      peer.outstanding.set(blockKey(pieceBlock), {
        pieceBlock,
        requestedAt: Date.now()
      });
    }
    this._scheduleRequestTimeout(peer);
  }

  _releaseOutstanding(peer) {
    this._clearRequestTimer(peer);
    for (const { pieceBlock } of peer.outstanding.values()) {
      this.pieces.releaseRequested(pieceBlock);
    }
    peer.outstanding.clear();
  }

  _scheduleRequestTimeout(peer) {
    this._clearRequestTimer(peer);
    if (this.requestTimeout === 0 || peer.outstanding.size === 0) return;

    const oldestRequest = Math.min(
      ...Array.from(peer.outstanding.values(), request => request.requestedAt)
    );
    const delay = Math.max(1, this.requestTimeout - (Date.now() - oldestRequest));
    peer.requestTimer = setTimeout(() => {
      peer.requestTimer = null;
      if (this.complete || this.activePeers.get(peer.id) !== peer) return;
      this.log(`peer ${peer.id} timed out with ${peer.outstanding.size} pending blocks`);
      peer.socket.destroy();
      this._handleDisconnect(peer.id);
    }, delay);
  }

  _clearRequestTimer(peer) {
    if (!peer.requestTimer) return;
    clearTimeout(peer.requestTimer);
    peer.requestTimer = null;
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

function blockKey(pieceBlock) {
  return `${pieceBlock.index}:${pieceBlock.begin}`;
}
