'use strict';

import fs from 'fs';
import path from 'path';
import net from 'net';
import * as tracker from './tracker.js';
import * as message from './message.js';
import Pieces from './Pieces.js';
import Queue from './Queue.js';

export default function download(torrent, rootPath) {
  return new Promise((resolve, reject) => {
    tracker.getPeers(torrent, peers => {
      const pieces = new Pieces(torrent);
      const sockets = new Set();
      let complete = false;

      if (peers.length === 0) {
        reject(new Error('No peers available'));
        return;
      }

      function onComplete() {
        if (complete) return;
        complete = true;
        for (const s of sockets) {
          try { s.end(); } catch (e) {}
        }
        resolve();
      }

      peers.forEach(peer => {
        const socket = new net.Socket();
        sockets.add(socket);
        socket.on('error', err => {
          console.log(err);
          sockets.delete(socket);
          if (sockets.size === 0 && !complete) {
            reject(err);
          }
        });
        socket.on('close', () => {
          sockets.delete(socket);
          if (pieces.isDone()) {
            onComplete();
          } else if (sockets.size === 0 && !complete) {
            reject(new Error('All peers disconnected before download complete'));
          }
        });
        socket.connect(peer.port, peer.ip, () => {
          socket.write(message.buildHandshake(torrent));
        });
        const queue = new Queue(torrent);
        onWholeMsg(socket, msg => msgHandler(msg, socket, torrent, pieces, queue, rootPath));
      });
    });
  });
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

function msgHandler(msg, socket, torrent, pieces, queue, rootPath) {
  if (isHandshake(msg)) {
    socket.write(message.buildInterested());
  } else {
    const m = message.parse(msg);

    if (m.id === 0) chokeHandler(socket);
    if (m.id === 1) unchokeHandler(socket, torrent, pieces, queue, rootPath);
    if (m.id === 4) haveHandler(socket, torrent, pieces, queue, rootPath, m.payload);
    if (m.id === 5) bitfieldHandler(socket, torrent, pieces, queue, rootPath, m.payload);
    if (m.id === 7) pieceHandler(socket, torrent, pieces, queue, rootPath, m.payload);
  }
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

function pieceHandler(socket, torrent, pieces, queue, rootPath, pieceResp) {
  console.log(pieceResp);
  pieces.addReceived(pieceResp);

  const offset = pieceResp.index * torrent.info['piece length'] + pieceResp.begin;
  writeBlock(torrent, rootPath, pieceResp.block, offset);

  if (pieces.isDone()) {
    console.log('DONE!');
    socket.end();
  } else {
    requestPiece(socket, torrent, pieces, queue, rootPath);
  }
}

function requestPiece(socket, torrent, pieces, queue, rootPath) {
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
    const fd = fs.openSync(file.path, 'w');
    fs.writeSync(fd, block, blockSliceStart, sliceLength, fileWriteOffset);
    fs.closeSync(fd);

    fileOffset += file.length;
  }
}
