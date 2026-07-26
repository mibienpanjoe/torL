'use strict';

import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import bencode from 'bencode';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const file1 = Buffer.from('Hello');
const file2 = Buffer.from(' World!\n');
const data = Buffer.concat([file1, file2]);
const pieceLen = 32768;
const pieces = crypto.createHash('sha1').update(data.slice(0, pieceLen)).digest();

const info = {
  'piece length': pieceLen,
  pieces,
  name: Buffer.from('test'),
  files: [
    { length: file1.length, path: [Buffer.from('a.txt')] },
    { length: file2.length, path: [Buffer.from('b.txt')] }
  ]
};

const torrent = { announce: Buffer.from('udp://127.0.0.1:0'), info };

fs.writeFileSync(path.join(__dirname, 'multi-file.torrent'), bencode.encode(torrent));

console.log('generated multi-file.torrent');
