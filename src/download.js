'use strict';

import fs from 'fs';
import net from 'net';
import * as tracker from './tracker.js';
import * as message from './message.js';
import Pieces from './Pieces.js';
import Queue from './Queue.js';

export default function download(torrent, path) {
  tracker.getPeers(torrent, peers => {
    const pieces = new Pieces(torrent);
    const file = fs.openSync(path, 'w');
    peers.forEach(peer => downloadFromPeer(peer, torrent, pieces, file));
  });
}

function downloadFromPeer(peer, torrent, pieces, file) {
  const socket = new net.Socket();
  socket.on('error', console.log);
  socket.connect(peer.port, peer.ip, () => {
    socket.write(message.buildHandshake(torrent));
  });
  const queue = new Queue(torrent);
  onWholeMsg(socket, msg => msgHandler(msg, socket, torrent, pieces, queue, file));
}

function onWholeMsg(socket, callback) {
  let savedBuf = Buffer.alloc(0);
  let handshake = true;

  socket.on('data', recvBuf => {
    // msgLen calculates the length of a whole message
    const msgLen = () => handshake ? savedBuf.readUInt8(0) + 49 : savedBuf.readInt32BE(0) + 4;
    savedBuf = Buffer.concat([savedBuf, recvBuf]);

    while (savedBuf.length >= 4 && savedBuf.length >= msgLen()) {
      callback(savedBuf.slice(0, msgLen()));
      savedBuf = savedBuf.slice(msgLen());
      handshake = false;
    }
  });
}

function msgHandler(msg, socket, torrent, pieces, queue, file) {
  if (isHandshake(msg)) {
    socket.write(message.buildInterested());
  } else {
    const m = message.parse(msg);

    if (m.id === 0) chokeHandler(socket);
    if (m.id === 1) unchokeHandler(socket, torrent, pieces, queue, file);
    if (m.id === 4) haveHandler(socket, torrent, pieces, queue, file, m.payload);
    if (m.id === 5) bitfieldHandler(socket, torrent, pieces, queue, file, m.payload);
    if (m.id === 7) pieceHandler(socket, torrent, pieces, queue, file, m.payload);
  }
}

function isHandshake(msg) {
  return msg.length === msg.readUInt8(0) + 49 &&
         msg.toString('utf8', 1, 20) === 'BitTorrent protocol';
}

function chokeHandler(socket) {
  socket.end();
}

function unchokeHandler(socket, torrent, pieces, queue, file) {
  queue.choked = false;
  requestPiece(socket, torrent, pieces, queue, file);
}

function haveHandler(socket, torrent, pieces, queue, file, payload) {
  const pieceIndex = payload.readUInt32BE(0);
  const queueEmpty = queue.length() === 0;
  queue.queue(pieceIndex);
  if (queueEmpty) requestPiece(socket, torrent, pieces, queue, file);
}

function bitfieldHandler(socket, torrent, pieces, queue, file, payload) {
  const queueEmpty = queue.length() === 0;
  payload.forEach((byte, i) => {
    let b = byte;
    for (let j = 0; j < 8; j++) {
      if (b % 2) queue.queue(i * 8 + 7 - j);
      b = Math.floor(b / 2);
    }
  });
  if (queueEmpty) requestPiece(socket, torrent, pieces, queue, file);
}

function pieceHandler(socket, torrent, pieces, queue, file, pieceResp) {
  console.log(pieceResp);
  pieces.addReceived(pieceResp);

  const offset = pieceResp.index * torrent.info['piece length'] + pieceResp.begin;
  fs.write(file, pieceResp.block, 0, pieceResp.block.length, offset, () => {});

  if (pieces.isDone()) {
    console.log('DONE!');
    socket.end();
    try { fs.closeSync(file); } catch (e) {}
  } else {
    requestPiece(socket, torrent, pieces, queue, file);
  }
}

function requestPiece(socket, torrent, pieces, queue, file) {
  if (queue.choked) return null;

  while (queue.length()) {
    const pieceBlock = queue.deque();
    if (pieces.needed(pieceBlock)) {
      socket.write(message.buildRequest(pieceBlock));
      pieces.addRequested(pieceBlock);
      break;
    }
  }
}
