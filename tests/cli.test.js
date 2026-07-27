'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, getUsage, run } from '../src/cli.js';

describe('cli', () => {
  it('parses a torrent file argument', () => {
    const options = parseArgs(['node', 'torl', 'file.torrent']);
    assert.strictEqual(options.input, 'file.torrent');
    assert.strictEqual(options.output, process.cwd());
    assert.strictEqual(options.quiet, false);
  });

  it('parses a magnet link argument', () => {
    const magnet = 'magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678';
    const options = parseArgs(['node', 'torl', magnet]);
    assert.strictEqual(options.input, magnet);
  });

  it('parses --output option', () => {
    const options = parseArgs(['node', 'torl', 'file.torrent', '--output', '/tmp/downloads']);
    assert.strictEqual(options.output, '/tmp/downloads');
  });

  it('parses -o shorthand', () => {
    const options = parseArgs(['node', 'torl', 'file.torrent', '-o', '/tmp/downloads']);
    assert.strictEqual(options.output, '/tmp/downloads');
  });

  it('parses --quiet flag', () => {
    const options = parseArgs(['node', 'torl', 'file.torrent', '--quiet']);
    assert.strictEqual(options.quiet, true);
  });

  it('parses --help flag', () => {
    const options = parseArgs(['node', 'torl', '--help']);
    assert.strictEqual(options.help, true);
  });

  it('parses --version flag', () => {
    const options = parseArgs(['node', 'torl', '--version']);
    assert.strictEqual(options.version, true);
  });

  it('throws on unknown option', () => {
    assert.throws(() => parseArgs(['node', 'torl', '--unknown']), /Unknown option/);
  });

  it('throws on missing --output value', () => {
    assert.throws(() => parseArgs(['node', 'torl', 'file.torrent', '--output']), /requires a value/);
  });

  it('throws on unexpected extra argument', () => {
    assert.throws(() => parseArgs(['node', 'torl', 'file.torrent', 'extra']), /Unexpected argument/);
  });

  it('returns usage text', () => {
    assert.ok(getUsage().includes('Usage: torl'));
  });

  it('parses --json flag', () => {
    const options = parseArgs(['node', 'torl', 'file.torrent', '--json']);
    assert.strictEqual(options.json, true);
  });

  it('rejects --json and --quiet together', async () => {
    await assert.rejects(
      run(['node', 'torl', 'file.torrent', '--json', '--quiet']),
      /Cannot use --json and --quiet together/
    );
  });
});
