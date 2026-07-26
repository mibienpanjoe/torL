'use strict';

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import bencode from 'bencode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const data = Buffer.from('Hello, World!');
const pieceLen = 32768;
const pieces = crypto.createHash('sha1').update(data.slice(0, pieceLen)).digest();

const info = {
  'piece length': pieceLen,
  pieces,
  length: data.length,
  name: Buffer.from('test.txt')
};

const torrent = { announce: Buffer.from('udp://tracker.example.com:6969'), info };

fs.writeFileSync(path.join(__dirname, 'single-file.torrent'), bencode.encode(torrent));

console.log('generated single-file.torrent');
