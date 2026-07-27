'use strict';

import { Buffer } from 'buffer';
import { getPeers } from './tracker.js';
import { DHTClient } from './dht.js';
import { downloadMetadata } from './metadata-downloader.js';

const DEFAULT_PORT = 6881;
const METADATA_TIMEOUT = 10000;

export async function resolveMagnet(magnet, options = {}) {
  const useDHT = options.useDHT !== false;
  const dhtBootstrapNodes = options.dhtBootstrapNodes;
  const signal = options.signal;
  const port = options.port || DEFAULT_PORT;

  const torrentStub = buildTorrentStub(magnet);

  const peers = options.peers && options.peers.length
    ? options.peers
    : await collectPeers(torrentStub, useDHT, dhtBootstrapNodes, signal);
  if (peers.length === 0) {
    throw new Error('No peers found for magnet link');
  }

  const errors = [];
  for (const peer of peers) {
    try {
      const { info, metadata } = await downloadMetadata(peer, magnet.infoHash, {
        timeout: METADATA_TIMEOUT
      });
      return buildTorrentFromMagnet(magnet, info, metadata);
    } catch (err) {
      errors.push(err.message);
    }
  }

  throw new Error('Failed to download metadata from any peer: ' + errors.join('; '));
}

function buildTorrentStub(magnet) {
  const announce = magnet.trackers[0];
  return {
    info: { length: magnet.length || 0 },
    infoHash: magnet.infoHash,
    announce: announce ? Buffer.from(announce) : null,
    'announce-list': magnet.trackers.length ? magnet.trackers.map(t => [Buffer.from(t)]) : []
  };
}

function buildTorrentFromMagnet(magnet, info, metadata) {
  const announce = magnet.trackers[0] || null;
  return {
    info,
    infoHash: magnet.infoHash,
    infoHashHex: magnet.infoHash.toString('hex'),
    announce: announce ? Buffer.from(announce) : null,
    announceList: magnet.trackers.length ? magnet.trackers.map(t => [t]) : [],
    name: info.name.toString('utf8'),
    length: info.length,
    metadata,
    isMagnet: true
  };
}

async function collectPeers(torrentStub, useDHT, dhtBootstrapNodes, signal) {
  const allPeers = [];
  const seen = new Set();

  function addPeers(peers) {
    for (const peer of peers) {
      const id = `${peer.ip}:${peer.port}`;
      if (!seen.has(id)) {
        seen.add(id);
        allPeers.push(peer);
      }
    }
  }

  if (torrentStub.announce) {
    const trackerPeers = await new Promise((resolve) => {
      getPeers(torrentStub, (peers) => resolve(peers), signal);
    });
    addPeers(trackerPeers);
  }

  if (useDHT) {
    const dhtClient = new DHTClient(dhtBootstrapNodes ? { bootstrapNodes: dhtBootstrapNodes } : {});
    await dhtClient.start();
    const dhtPeers = await new Promise((resolve) => {
      dhtClient.findPeers(torrentStub, resolve);
    });
    dhtClient.stop();
    addPeers(dhtPeers);
  }

  return allPeers;
}
