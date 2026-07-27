'use strict';

import dgram from 'dgram';
import { Buffer } from 'buffer';
import crypto from 'crypto';
import bencode from 'bencode';
import * as torrentParser from './torrent-parser.js';
import * as util from './util.js';

function getTrackerTimeout() {
  const value = parseInt(process.env.TORL_TRACKER_TIMEOUT, 10);
  return value > 0 ? value : 15000;
}

export function getPeers(torrent, callback, signal) {
  const urls = getAnnounceUrls(torrent);
  tryTrackers(torrent, urls, callback, signal);
}

function computeTotalSize(torrent) {
  if (torrent.info.files) {
    return torrent.info.files.reduce((sum, f) => sum + f.length, 0);
  }
  return torrent.info.length || 0;
}

function getAnnounceUrls(torrent) {
  const urls = [];
  if (torrent['announce-list'] && Array.isArray(torrent['announce-list'])) {
    for (const tier of torrent['announce-list']) {
      for (const url of tier) {
        urls.push(url.toString('utf8'));
      }
    }
  }
  if (torrent.announce && torrent.announce.length > 0) {
    const primary = torrent.announce.toString('utf8');
    if (!urls.includes(primary)) {
      urls.unshift(primary);
    }
  }
  return urls;
}

function tryTrackers(torrent, urls, callback, signal, bestInterval = 60) {
  if (urls.length === 0) {
    callback([], bestInterval);
    return;
  }

  const [url, ...rest] = urls;
  const trackerSignal = combineTimeoutSignal(signal, getTrackerTimeout());

  function onDone(peers, interval) {
    trackerSignal.cleanup();
    if (peers.length > 0) {
      callback(peers, interval || bestInterval);
      return;
    }
    // Empty response: try the next tracker.
    tryTrackers(torrent, rest, callback, signal, interval > 0 ? interval : bestInterval);
  }

  function onError(err) {
    trackerSignal.cleanup();
    console.warn(`Tracker ${url} failed: ${err.message}`);
    tryTrackers(torrent, rest, callback, signal, bestInterval);
  }

  try {
    if (url.startsWith('udp')) {
      udpGetPeers(torrent, url, onDone, onError, trackerSignal.signal);
    } else {
      httpGetPeers(torrent, url, onDone, onError, trackerSignal.signal);
    }
  } catch (err) {
    onError(err);
  }
}

function combineTimeoutSignal(signal, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  if (signal) {
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      controller.abort();
    }, { once: true });
  }

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer)
  };
}

// --- UDP tracker ---

function udpGetPeers(torrent, url, onDone, onError, signal) {
  const socket = dgram.createSocket('udp4');
  let closed = false;
  const timer = setTimeout(() => {
    if (!closed) {
      closed = true;
      try { socket.close(); } catch (e) {}
      onError(new Error('UDP tracker timeout'));
    }
  }, getTrackerTimeout());

  if (signal) {
    signal.addEventListener('abort', () => {
      if (!closed) {
        closed = true;
        clearTimeout(timer);
        try { socket.close(); } catch (e) {}
        onError(new Error('Tracker request aborted'));
      }
    }, { once: true });
  }

  socket.on('error', err => {
    if (!closed) {
      closed = true;
      clearTimeout(timer);
      try { socket.close(); } catch (e) {}
      onError(err);
    }
  });

  // 1. send connect request
  udpSend(socket, buildConnReq(), url);

  socket.on('message', response => {
    if (respType(response) === 'connect') {
      // 2. receive and parse connect response
      const connResp = parseConnResp(response);
      // 3. send announce request
      const announceReq = buildAnnounceReq(connResp.connectionId, torrent);
      udpSend(socket, announceReq, url);
    } else if (respType(response) === 'announce') {
      // 4. parse announce response
      const announceResp = parseAnnounceResp(response);
      // 5. pass peers and interval to callback and close the socket
      if (!closed) {
        closed = true;
        clearTimeout(timer);
        try { socket.close(); } catch (e) {}
        onDone(announceResp.peers, announceResp.interval);
      }
    }
  });
}

function udpSend(socket, message, rawUrl, callback = () => {}) {
  const url = new URL(rawUrl);
  socket.send(message, 0, message.length, url.port, url.hostname, callback);
}

// identify the type of the response received from the tracker
function respType(resp) {
  const action = resp.readUInt32BE(0);
  if (action === 0) return 'connect';
  if (action === 1) return 'announce';
}

// connect request function
function buildConnReq() {
  const buf = Buffer.alloc(16);

  // connection id
  buf.writeUInt32BE(0x417, 0);
  buf.writeUInt32BE(0x27101980, 4);
  // action
  buf.writeUInt32BE(0, 8);
  // transaction id
  crypto.randomBytes(4).copy(buf, 12);

  return buf;
}

// connect response parser
function parseConnResp(resp) {
  return {
    action: resp.readUInt32BE(0),
    transactionId: resp.readUInt32BE(4),
    connectionId: resp.slice(8)
  };
}

// announce request
function buildAnnounceReq(connId, torrent, port = 6881) {
  const buf = Buffer.allocUnsafe(98);

  // connection id
  connId.copy(buf, 0);
  // action
  buf.writeUInt32BE(1, 8);
  // transaction id
  crypto.randomBytes(4).copy(buf, 12);
  // info hash
  const infoHash = torrent.infoHash || torrentParser.infoHash(torrent);
  infoHash.copy(buf, 16);
  // peerId
  util.genId().copy(buf, 36);
  // downloaded
  Buffer.alloc(8).copy(buf, 56);
  // left
  const totalSize = computeTotalSize(torrent);
  if (totalSize === 0) {
    Buffer.alloc(8, 0xff).copy(buf, 64);
  } else {
    torrentParser.size(torrent).copy(buf, 64);
  }
  // uploaded
  Buffer.alloc(8).copy(buf, 72);
  // event
  buf.writeUInt32BE(0, 80);
  // ip address
  buf.writeUInt32BE(0, 84);
  // key
  crypto.randomBytes(4).copy(buf, 88);
  // num want
  buf.writeInt32BE(-1, 92);
  // port
  buf.writeUInt16BE(port, 96);

  return buf;
}

// announce response parser
function parseAnnounceResp(resp) {
  function group(iterable, groupSize) {
    let groups = [];
    for (let i = 0; i < iterable.length; i += groupSize) {
      groups.push(iterable.slice(i, i + groupSize));
    }
    return groups;
  }

  return {
    action: resp.readUInt32BE(0),
    transactionId: resp.readUInt32BE(4),
    interval: resp.readUInt32BE(8),
    leechers: resp.readUInt32BE(12),
    seeders: resp.readUInt32BE(16),
    peers: group(resp.slice(20), 6).map(address => {
      return {
        ip: address.slice(0, 4).join('.'),
        port: address.readUInt16BE(4)
      };
    })
  };
}

// --- HTTP tracker ---

async function httpGetPeers(torrent, url, onDone, onError, signal) {
  const infoHash = torrent.infoHash || torrentParser.infoHash(torrent);
  const peerId = util.genId();
  let left = torrent.info.files
    ? torrent.info.files.reduce((sum, f) => sum + f.length, 0)
    : (torrent.info.length || 0);
  if (left === 0) left = -1;

  const fullUrl = buildHttpUrl(url, infoHash, peerId, left);

  try {
    const response = await fetch(fullUrl, { signal });
    const arrayBuffer = await response.arrayBuffer();
    const decoded = bencode.decode(Buffer.from(arrayBuffer));

    if (decoded['failure reason']) {
      throw new Error(decoded['failure reason'].toString('utf8'));
    }

    const peers = decoded.peers ? Buffer.from(decoded.peers) : Buffer.alloc(0);
    const peerList = [];
    for (let i = 0; i < peers.length; i += 6) {
      peerList.push({
        ip: peers.slice(i, i + 4).join('.'),
        port: peers.readUInt16BE(i + 4)
      });
    }

    const interval = typeof decoded.interval === 'number' ? decoded.interval : 60;
    onDone(peerList, interval);
  } catch (err) {
    onError(err);
  }
}

function buildHttpUrl(announceUrl, infoHash, peerId, left) {
  const params = [
    'info_hash=' + urlEncodeBuffer(infoHash),
    'peer_id=' + urlEncodeBuffer(peerId),
    'port=6881',
    'uploaded=0',
    'downloaded=0',
    'left=' + left,
    'compact=1',
    'event=started'
  ].join('&');
  return announceUrl + (announceUrl.includes('?') ? '&' : '?') + params;
}

function urlEncodeBuffer(buf) {
  return Array.from(buf).map(b => `%${b.toString(16).padStart(2, '0')}`).join('');
}
