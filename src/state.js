'use strict';

import fs from 'fs';

const STATE_VERSION = 1;
const STATE_SUFFIX = '.torl.state';

export function load(rootPath) {
  const statePath = rootPath + STATE_SUFFIX;
  try {
    const content = fs.readFileSync(statePath, 'utf8');
    const state = JSON.parse(content);
    if (state.version !== STATE_VERSION) return null;
    return Buffer.from(state.bitfield, 'base64');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    return null;
  }
}

export function save(rootPath, bitfield) {
  const statePath = rootPath + STATE_SUFFIX;
  const state = {
    version: STATE_VERSION,
    bitfield: bitfield.toString('base64')
  };
  fs.writeFileSync(statePath, JSON.stringify(state));
}

export function emptyBitfield(nPieces) {
  return Buffer.alloc(Math.ceil(nPieces / 8));
}

export function setBit(bitfield, index) {
  bitfield[Math.floor(index / 8)] |= 0x80 >> (index % 8);
}

export function hasBit(bitfield, index) {
  return (bitfield[Math.floor(index / 8)] & (0x80 >> (index % 8))) !== 0;
}
