'use strict';

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import bencode from 'bencode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PIECE_LEN = 16384;
const pieceA = Buffer.alloc(PIECE_LEN, 'A');
const pieceB = Buffer.alloc(PIECE_LEN, 'B');
const data = Buffer.concat([pieceA, pieceB]);

const pieces = Buffer.concat([
  crypto.createHash('sha1').update(pieceA).digest(),
  crypto.createHash('sha1').update(pieceB).digest()
]);

const info = {
  'piece length': PIECE_LEN,
  pieces,
  length: data.length,
  name: Buffer.from('resume.txt')
};

const torrent = { announce: Buffer.from('udp://127.0.0.1:0'), info };

fs.writeFileSync(path.join(__dirname, 'resume.torrent'), bencode.encode(torrent));
fs.writeFileSync(path.join(__dirname, 'resume.data'), data);

console.log('generated resume.torrent and resume.data');
