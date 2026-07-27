'use strict';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(str) {
  const cleaned = str.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const output = [];
  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) throw new Error(`Invalid base32 character: ${char}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function parseInfoHash(xt) {
  if (xt.startsWith('urn:btih:')) {
    const hash = xt.slice('urn:btih:'.length);
    if (hash.length === 40) {
      return Buffer.from(hash, 'hex');
    }
    if (hash.length === 32) {
      return decodeBase32(hash);
    }
    throw new Error('Unsupported info hash length in magnet link');
  }
  if (xt.startsWith('urn:btmh:1220')) {
    const hash = xt.slice('urn:btmh:1220'.length);
    if (hash.length === 64) {
      return Buffer.from(hash, 'hex');
    }
    throw new Error('Unsupported v2 info hash length in magnet link');
  }
  throw new Error('Unsupported info hash scheme in magnet link');
}

export function parseMagnetLink(link) {
  if (!link.startsWith('magnet:?')) {
    throw new Error('Invalid magnet link');
  }

  const query = link.slice('magnet:?'.length);
  const params = new URLSearchParams(query);

  const xt = params.get('xt');
  if (!xt) {
    throw new Error('Magnet link missing xt parameter');
  }

  const infoHash = parseInfoHash(xt);
  const name = params.get('dn') || '';
  const trackers = params.getAll('tr');
  const length = params.has('xl') ? parseInt(params.get('xl'), 10) : null;

  return {
    infoHash,
    infoHashHex: infoHash.toString('hex'),
    name,
    trackers,
    length
  };
}

export function magnetLinkToTorrent(magnet) {
  return {
    infoHash: magnet.infoHash,
    infoHashHex: magnet.infoHashHex,
    announce: magnet.trackers[0] || null,
    announceList: magnet.trackers.length ? magnet.trackers.map(t => [t]) : [],
    name: magnet.name,
    length: magnet.length,
    isMagnet: true
  };
}
