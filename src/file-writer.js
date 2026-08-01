'use strict';

import fs from 'fs';
import path from 'path';

export default class FileWriter {
  constructor(torrent, rootPath) {
    const files = torrent.info.files
      ? torrent.info.files.map(file => ({
          length: file.length,
          path: path.join(rootPath, ...file.path.map(part => part.toString('utf8')))
        }))
      : [{ length: torrent.info.length, path: rootPath }];

    let offset = 0;
    this.files = files.map(file => {
      const entry = { ...file, offset, fd: null };
      offset += file.length;
      return entry;
    });
    this.closed = false;
  }

  write(block, offset) {
    if (this.closed) throw new Error('Cannot write after FileWriter is closed');

    const blockEnd = offset + block.length;
    for (const file of this.files) {
      const fileEnd = file.offset + file.length;
      if (blockEnd <= file.offset || offset >= fileEnd) continue;

      const overlapStart = Math.max(offset, file.offset);
      const overlapEnd = Math.min(blockEnd, fileEnd);
      const blockSliceStart = overlapStart - offset;
      const fileWriteOffset = overlapStart - file.offset;
      const sliceLength = overlapEnd - overlapStart;

      if (file.fd === null) {
        fs.mkdirSync(path.dirname(file.path), { recursive: true });
        file.fd = fs.openSync(file.path, fs.existsSync(file.path) ? 'r+' : 'w');
      }
      fs.writeSync(file.fd, block, blockSliceStart, sliceLength, fileWriteOffset);
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;

    let closeError = null;
    for (const file of this.files) {
      if (file.fd === null) continue;
      try {
        fs.closeSync(file.fd);
      } catch (err) {
        closeError ||= err;
      } finally {
        file.fd = null;
      }
    }
    if (closeError) throw closeError;
  }
}
