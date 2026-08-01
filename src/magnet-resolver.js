'use strict';

import { Buffer } from 'buffer';
import dgram from 'dgram';
import crypto from 'crypto';
import bencode from 'bencode';
import * as util from './util.js';
import { downloadMetadata } from './metadata-downloader.js';

const METADATA_TIMEOUT = 10000;
const TRACKER_QUERY_TIMEOUT = 5000;
const DHT_QUERY_TIMEOUT = 30000;

export async function resolveMagnet(magnet, options = {}) {
  const useDHT = options.useDHT !== false;
  const dhtBootstrapNodes = options.dhtBootstrapNodes;
  const signal = options.signal;
  throwIfAborted(signal);

  const torrentStub = buildTorrentStub(magnet);

  const peers = options.peers && options.peers.length
    ? options.peers
    : await collectPeers(torrentStub, useDHT, dhtBootstrapNodes, signal);
  if (peers.length === 0) {
    throwIfAborted(signal);
    throw new Error('No peers found for magnet link');
  }

  return resolveMetadata(magnet, peers, options);
}

async function resolveMetadata(magnet, peers, options) {
  const errors = [];
  const parentSignal = options.signal;
  const metadataAbort = linkedAbortController(parentSignal);
  const requestedConcurrency = options.metadataConcurrency ?? 8;
  const concurrency = Math.min(
    peers.length,
    Number.isInteger(requestedConcurrency) && requestedConcurrency > 0 ? requestedConcurrency : 8
  );
  let nextPeer = 0;
  let resolved = null;

  async function worker() {
    while (!metadataAbort.controller.signal.aborted) {
      const peer = peers[nextPeer++];
      if (!peer) return;
      try {
        const { info, metadata } = await downloadMetadata(peer, magnet.infoHash, {
          timeout: options.metadataTimeout ?? METADATA_TIMEOUT,
          signal: metadataAbort.controller.signal
        });
        if (!resolved) {
          resolved = buildTorrentFromMagnet(magnet, info, metadata);
          metadataAbort.controller.abort();
        }
        return;
      } catch (err) {
        if (parentSignal?.aborted) throw createAbortError();
        if (err.name !== 'AbortError') {
          errors.push(`${peer.ip}:${peer.port}: ${err.message}`);
        }
      }
    }
  }

  try {
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally {
    metadataAbort.cleanup();
  }

  throwIfAborted(parentSignal);
  if (resolved) return resolved;
  throw new Error('Failed to download metadata from any peer: ' + errors.join('; '));
}

function buildTorrentStub(magnet) {
  const announce = magnet.trackers[0];
  return {
    info: { length: magnet.length || 0 },
    infoHash: magnet.infoHash,
    announce: announce ? Buffer.from(announce) : null,
    'announce-list': magnet.trackers.length ? magnet.trackers.map(t => [Buffer.from(t)]) : []
  };
}

function buildTorrentFromMagnet(magnet, info, metadata) {
  const announce = magnet.trackers[0] || null;
  return {
    info,
    infoHash: magnet.infoHash,
    infoHashHex: magnet.infoHash.toString('hex'),
    announce: announce ? Buffer.from(announce) : null,
    'announce-list': magnet.trackers.length ? magnet.trackers.map(t => [Buffer.from(t)]) : [],
    name: info.name.toString('utf8'),
    length: info.length,
    metadata,
    isMagnet: true
  };
}

async function collectPeers(torrentStub, useDHT, dhtBootstrapNodes, signal) {
  const trackerAbort = linkedAbortController(signal);
  const dhtAbort = linkedAbortController(signal);
  const trackerSource = {
    name: 'tracker',
    promise: queryTrackers(torrentStub, trackerAbort.controller.signal)
  };
  const dhtSource = {
    name: 'dht',
    promise: useDHT
      ? queryDHT(torrentStub, dhtBootstrapNodes, dhtAbort.controller.signal)
      : Promise.resolve([])
  };

  try {
    const first = await Promise.race([
      trackerSource.promise.then(peers => ({ name: trackerSource.name, peers })),
      dhtSource.promise.then(peers => ({ name: dhtSource.name, peers }))
    ]);
    if (first.peers.length > 0) {
      (first.name === 'tracker' ? dhtAbort : trackerAbort).controller.abort();
      return dedupePeers(first.peers);
    }

    const second = first.name === 'tracker'
      ? await dhtSource.promise
      : await trackerSource.promise;
    return dedupePeers(second);
  } finally {
    trackerAbort.cleanup();
    dhtAbort.cleanup();
  }
}

async function queryTrackers(torrent, signal) {
  const urls = getAnnounceUrls(torrent);
  const results = await Promise.all(urls.map(url => querySingleTracker(torrent, url, signal)));
  return dedupePeers(results.flat());
}

function dedupePeers(peers) {
  const seen = new Set();
  return peers.filter(peer => {
    const id = `${peer.ip}:${peer.port}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function getAnnounceUrls(torrentStub) {
  const urls = [];
  if (torrentStub['announce-list'] && Array.isArray(torrentStub['announce-list'])) {
    for (const tier of torrentStub['announce-list']) {
      for (const url of tier) {
        urls.push(url.toString('utf8'));
      }
    }
  }
  if (torrentStub.announce && torrentStub.announce.length > 0) {
    const primary = torrentStub.announce.toString('utf8');
    if (!urls.includes(primary)) urls.push(primary);
  }
  return urls;
}

async function querySingleTracker(torrent, url, signal) {
  const trackerSignal = combineSignal(signal, TRACKER_QUERY_TIMEOUT);
  try {
    return await new Promise((resolve) => {
      getPeersForUrl(torrent, url, (peers) => resolve(peers), trackerSignal.signal);
    });
  } catch (e) {
    return [];
  } finally {
    trackerSignal.cleanup();
  }
}

function combineSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parentSignal?.removeEventListener('abort', onParentAbort);
    }
  };
}

function linkedAbortController(parentSignal) {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  if (parentSignal?.aborted) controller.abort();
  else parentSignal?.addEventListener('abort', onParentAbort, { once: true });
  return {
    controller,
    cleanup: () => parentSignal?.removeEventListener('abort', onParentAbort)
  };
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw createAbortError();
}

function createAbortError() {
  const error = new Error('Magnet resolution aborted');
  error.name = 'AbortError';
  return error;
}

function getPeersForUrl(torrent, url, callback, signal) {
  const peerId = util.genId();
  const infoHash = torrent.infoHash;

  if (url.startsWith('udp')) {
    udpQueryPeers(url, infoHash, peerId, callback, signal);
  } else {
    httpQueryPeers(url, infoHash, peerId, torrent, callback, signal);
  }
}

function udpQueryPeers(urlStr, infoHash, peerId, callback, signal) {
  const url = new URL(urlStr);
  const socket = dgram.createSocket('udp4');
  let closed = false;
  let expectedTransactionId;

  function finish(peers = []) {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    try { socket.close(); } catch (e) {}
    callback(peers);
  }

  const timer = setTimeout(() => finish(), TRACKER_QUERY_TIMEOUT);
  const onAbort = () => finish();

  if (signal?.aborted) finish();
  else signal?.addEventListener('abort', onAbort, { once: true });

  socket.on('error', () => finish());

  function udpSend(message) {
    if (closed) return;
    socket.send(message, 0, message.length, url.port, url.hostname, err => {
      if (err) finish();
    });
  }

  const connBuf = Buffer.alloc(16);
  connBuf.writeUInt32BE(0x417, 0);
  connBuf.writeUInt32BE(0x27101980, 4);
  connBuf.writeUInt32BE(0, 8);
  crypto.randomBytes(4).copy(connBuf, 12);
  expectedTransactionId = connBuf.readUInt32BE(12);
  udpSend(connBuf);

  socket.on('message', response => {
    if (response.length < 8) {
      finish();
      return;
    }
    const action = response.readUInt32BE(0);
    const transactionId = response.readUInt32BE(4);
    if (transactionId !== expectedTransactionId) return;

    if (action === 3) {
      finish();
      return;
    }

    if (action === 0) {
      if (response.length < 16) {
        finish();
        return;
      }
      const connId = response.subarray(8, 16);
      const announce = Buffer.alloc(98);
      connId.copy(announce, 0);
      announce.writeUInt32BE(1, 8);
      crypto.randomBytes(4).copy(announce, 12);
      expectedTransactionId = announce.readUInt32BE(12);
      infoHash.copy(announce, 16);
      peerId.copy(announce, 36);
      Buffer.alloc(8, 0xff).copy(announce, 64); // left = unknown
      announce.writeUInt32BE(0, 80);
      announce.writeUInt32BE(0, 84);
      crypto.randomBytes(4).copy(announce, 88);
      announce.writeInt32BE(-1, 92);
      announce.writeUInt16BE(6881, 96);
      udpSend(announce);
    } else if (action === 1) {
      if (response.length < 20) {
        finish();
        return;
      }
      const peers = [];
      const raw = response.subarray(20);
      for (let i = 0; i + 6 <= raw.length; i += 6) {
        peers.push({
          ip: raw.subarray(i, i + 4).join('.'),
          port: raw.readUInt16BE(i + 4)
        });
      }
      finish(peers);
    }
  });
}

async function httpQueryPeers(url, infoHash, peerId, torrent, callback, signal) {
  try {
    let left = torrent.info.files
      ? torrent.info.files.reduce((sum, f) => sum + f.length, 0)
      : (torrent.info.length || 0);
    if (left === 0) left = -1;
    const params = [
      'info_hash=' + urlEncode(infoHash),
      'peer_id=' + urlEncode(peerId),
      'port=6881', 'uploaded=0', 'downloaded=0',
      'left=' + left, 'compact=1', 'event=started'
    ].join('&');
    const target = url + (url.includes('?') ? '&' : '?') + params;
    const response = await fetch(target, { signal });
    const data = Buffer.from(await response.arrayBuffer());
    const decoded = bencode.decode(data);
    if (decoded['failure reason']) {
      callback([]);
      return;
    }
    const raw = decoded.peers ? Buffer.from(decoded.peers) : Buffer.alloc(0);
    const peers = [];
    for (let i = 0; i + 6 <= raw.length; i += 6) {
      peers.push({
        ip: raw.slice(i, i + 4).join('.'),
        port: raw.readUInt16BE(i + 4)
      });
    }
    callback(peers);
  } catch (e) {
    callback([]);
  }
}

function urlEncode(buf) {
  return Array.from(buf).map(b => '%' + b.toString(16).padStart(2, '0')).join('');
}

async function queryDHT(torrent, dhtBootstrapNodes, signal) {
  let client;
  let timer;
  let onAbort;
  try {
    if (signal?.aborted) return [];
    const { DHTClient } = await import('./dht.js');
    client = new DHTClient(dhtBootstrapNodes ? { bootstrapNodes: dhtBootstrapNodes } : {});
    await client.start();
    const lookup = new Promise((resolve, reject) => {
      timer = setTimeout(() => resolve([]), DHT_QUERY_TIMEOUT);
      client.findPeers(torrent, resolve).catch(reject);
    });
    const aborted = new Promise(resolve => {
      onAbort = () => resolve([]);
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([lookup, aborted]);
  } catch (e) {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    client?.stop();
  }
}
