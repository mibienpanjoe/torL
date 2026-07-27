'use strict';

import { Buffer } from 'buffer';
import dgram from 'dgram';
import crypto from 'crypto';
import bencode from 'bencode';
import * as util from './util.js';
import { downloadMetadata } from './metadata-downloader.js';

const DEFAULT_PORT = 6881;
const METADATA_TIMEOUT = 10000;
const PEER_DEADLINE = 45000;
const TRACKER_QUERY_TIMEOUT = 5000;

export async function resolveMagnet(magnet, options = {}) {
  const useDHT = options.useDHT !== false;
  const dhtBootstrapNodes = options.dhtBootstrapNodes;
  const signal = options.signal;

  const torrentStub = buildTorrentStub(magnet);

  const peers = options.peers && options.peers.length
    ? options.peers
    : await collectPeers(torrentStub, useDHT, dhtBootstrapNodes, signal);
  if (peers.length === 0) {
    throw new Error('No peers found for magnet link');
  }

  const errors = [];

  // Try metadata peers concurrently. First success wins.
  const metaPromises = peers.map(peer =>
    downloadMetadata(peer, magnet.infoHash, { timeout: METADATA_TIMEOUT })
      .then(({ info, metadata }) => buildTorrentFromMagnet(magnet, info, metadata))
      .catch(err => { errors.push(err.message); throw err; })
  );

  try {
    return await Promise.any(metaPromises);
  } catch (e) {
    throw new Error('Failed to download metadata from any peer: ' + errors.join('; '));
  }
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
  const allPeers = [];
  const seen = new Set();

  function addPeers(peers) {
    for (const peer of peers) {
      const id = `${peer.ip}:${peer.port}`;
      if (!seen.has(id)) {
        seen.add(id);
        allPeers.push(peer);
      }
    }
  }

  const promises = [];

  if (torrentStub.announce) {
    const urls = getAnnounceUrls(torrentStub);
    for (const url of urls) {
      promises.push(querySingleTracker(torrentStub, url, signal, addPeers));
    }
  }

  if (useDHT) {
    promises.push(queryDHT(torrentStub, dhtBootstrapNodes, addPeers));
  }

  await withDeadline(promises, PEER_DEADLINE);

  return allPeers;
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

async function querySingleTracker(torrent, url, signal, addPeersFn) {
  try {
    const trackerSignal = combineSignal(signal, TRACKER_QUERY_TIMEOUT);
    const result = await new Promise((resolve) => {
      getPeersForUrl(torrent, url, (peers) => resolve(peers), trackerSignal.signal);
    });
    trackerSignal.cleanup();
    if (result.length > 0) addPeersFn(result);
  } catch (e) {
    // Silently skip failed/empty trackers.
  }
}

function combineSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (parentSignal) {
    parentSignal.addEventListener('abort', () => {
      clearTimeout(timer);
      controller.abort();
    }, { once: true });
  }
  return { signal: controller.signal, cleanup: () => clearTimeout(timer) };
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
  const socket = dgram.createSocket('udp4');
  const url = new URL(urlStr);
  let closed = false;
  const timer = setTimeout(() => {
    if (!closed) { closed = true; try { socket.close(); } catch (e) {} callback([]); }
  }, TRACKER_QUERY_TIMEOUT);

  if (signal) {
    signal.addEventListener('abort', () => {
      if (!closed) { closed = true; clearTimeout(timer); try { socket.close(); } catch (e) {} callback([]); }
    }, { once: true });
  }

  function udpSend(message) {
    socket.send(message, 0, message.length, url.port, url.hostname);
  }

  const connBuf = Buffer.alloc(16);
  connBuf.writeUInt32BE(0x417, 0);
  connBuf.writeUInt32BE(0x27101980, 4);
  connBuf.writeUInt32BE(0, 8);
  crypto.randomBytes(4).copy(connBuf, 12);
  udpSend(connBuf);

  socket.on('message', response => {
    const action = response.readUInt32BE(0);
    if (action === 0) {
      const connId = response.slice(8);
      const announce = Buffer.allocUnsafe(98);
      connId.copy(announce, 0);
      announce.writeUInt32BE(1, 8);
      crypto.randomBytes(4).copy(announce, 12);
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
      if (!closed) {
        closed = true;
        clearTimeout(timer);
        try { socket.close(); } catch (e) {}
        const peers = [];
        const raw = response.slice(20);
        for (let i = 0; i + 6 <= raw.length; i += 6) {
          peers.push({
            ip: raw.slice(i, i + 4).join('.'),
            port: raw.readUInt16BE(i + 4)
          });
        }
        callback(peers);
      }
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

async function queryDHT(torrent, dhtBootstrapNodes, addPeersFn) {
  try {
    const { DHTClient } = await import('./dht.js');
    const client = new DHTClient(dhtBootstrapNodes ? { bootstrapNodes: dhtBootstrapNodes } : {});
    await client.start();
    const peers = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve([]), 30000);
      client.findPeers(torrent, (result) => {
        clearTimeout(timer);
        resolve(result);
      });
    });
    client.stop();
    if (peers.length > 0) addPeersFn(peers);
  } catch (e) {
    // DHT failure is non-fatal.
  }
}

async function withDeadline(promises, timeoutMs) {
  if (promises.length === 0) return;
  await Promise.race([
    Promise.allSettled(promises),
    new Promise(resolve => setTimeout(resolve, timeoutMs))
  ]);
}
