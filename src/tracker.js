'use strict';

import dgram from 'dgram';
import { Buffer } from 'buffer';
import crypto from 'crypto';
import bencode from 'bencode';
import * as torrentParser from './torrent-parser.js';
import * as util from './util.js';

export function getPeers(torrent, callback, signal) {
  const url = torrent.announce.toString('utf8');
  if (url.startsWith('udp')) {
    udpGetPeers(torrent, callback, signal);
  } else {
    httpGetPeers(torrent, callback, signal);
  }
}

// --- UDP tracker ---

function udpGetPeers(torrent, callback, signal) {
  const socket = dgram.createSocket('udp4');
  const url = torrent.announce.toString('utf8');

  if (signal) {
    signal.addEventListener('abort', () => {
      try { socket.close(); } catch (e) {}
    }, { once: true });
  }

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
      callback(announceResp.peers, announceResp.interval);
      socket.close();
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
  torrentParser.size(torrent).copy(buf, 64);
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

async function httpGetPeers(torrent, callback, signal) {
  const announceUrl = torrent.announce.toString('utf8');
  const infoHash = torrent.infoHash || torrentParser.infoHash(torrent);
  const peerId = util.genId();
  const left = torrent.info.files
    ? torrent.info.files.reduce((sum, f) => sum + f.length, 0)
    : (torrent.info.length || 0);

  const url = buildHttpUrl(announceUrl, infoHash, peerId, left);

  const response = await fetch(url, { signal });
  const arrayBuffer = await response.arrayBuffer();
  const decoded = bencode.decode(Buffer.from(arrayBuffer));

  if (decoded['failure reason']) {
    throw new Error(decoded['failure reason'].toString('utf8'));
  }

  const peers = Buffer.from(decoded.peers);
  const peerList = [];
  for (let i = 0; i < peers.length; i += 6) {
    peerList.push({
      ip: peers.slice(i, i + 4).join('.'),
      port: peers.readUInt16BE(i + 4)
    });
  }

  const interval = typeof decoded.interval === 'number' ? decoded.interval : 60;
  callback(peerList, interval);
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
