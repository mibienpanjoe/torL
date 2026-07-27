'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseMagnetLink, magnetLinkToTorrent } from '../src/magnet-parser.js';

describe('magnet-parser', () => {
  it('parses a magnet link with hex info hash', () => {
    const link = 'magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&dn=Test+File&tr=http%3A%2F%2Ftracker.example.com%2Fannounce';
    const parsed = parseMagnetLink(link);
    assert.strictEqual(parsed.infoHashHex, '1234567890abcdef1234567890abcdef12345678');
    assert.strictEqual(parsed.name, 'Test File');
    assert.deepStrictEqual(parsed.trackers, ['http://tracker.example.com/announce']);
  });

  it('parses a magnet link with base32 info hash', () => {
    const link = 'magnet:?xt=urn:btih:CI2FM6EQVPG66ERUKZ4JBK6N54JDIVTY&dn=Base32';
    const parsed = parseMagnetLink(link);
    assert.strictEqual(parsed.infoHash.length, 20);
    assert.strictEqual(parsed.name, 'Base32');
  });

  it('parses multiple trackers', () => {
    const link = 'magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&tr=udp%3A%2F%2Ftracker1.com%3A80&tr=udp%3A%2F%2Ftracker2.com%3A80';
    const parsed = parseMagnetLink(link);
    assert.deepStrictEqual(parsed.trackers, ['udp://tracker1.com:80', 'udp://tracker2.com:80']);
  });

  it('throws on invalid magnet link', () => {
    assert.throws(() => parseMagnetLink('not-a-magnet'), /Invalid magnet link/);
  });

  it('throws on missing xt', () => {
    assert.throws(() => parseMagnetLink('magnet:?dn=NoHash'), /missing xt/);
  });

  it('converts parsed magnet to torrent metadata shape', () => {
    const parsed = parseMagnetLink('magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678&dn=Test&tr=udp://tracker.com');
    const torrent = magnetLinkToTorrent(parsed);
    assert.strictEqual(torrent.infoHash.toString('hex'), '1234567890abcdef1234567890abcdef12345678');
    assert.strictEqual(torrent.name, 'Test');
    assert.strictEqual(torrent.announce, 'udp://tracker.com');
    assert.deepStrictEqual(torrent.announceList, [['udp://tracker.com']]);
    assert.strictEqual(torrent.isMagnet, true);
  });
});
