'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs, getUsage, run, _run, getDefaultOutputDir, selectDownloadEngine } from '../src/cli.js';

describe('cli', () => {
  it('parses a torrent file argument', () => {
    const options = parseArgs(['node', 'torl-cli', 'file.torrent']);
    assert.deepStrictEqual(options.inputs, ['file.torrent']);
    assert.strictEqual(options.output, getDefaultOutputDir());
    assert.strictEqual(options.quiet, false);
  });

  it('parses a magnet link argument', () => {
    const magnet = 'magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678';
    const options = parseArgs(['node', 'torl-cli', magnet]);
    assert.deepStrictEqual(options.inputs, [magnet]);
  });

  it('parses multiple inputs', () => {
    const options = parseArgs(['node', 'torl-cli', 'a.torrent', 'b.torrent', 'magnet:?xt=urn:btih:abc']);
    assert.deepStrictEqual(options.inputs, ['a.torrent', 'b.torrent', 'magnet:?xt=urn:btih:abc']);
  });

  it('parses --output option', () => {
    const options = parseArgs(['node', 'torl-cli', 'file.torrent', '--output', '/tmp/downloads']);
    assert.strictEqual(options.output, '/tmp/downloads');
  });

  it('parses -o shorthand', () => {
    const options = parseArgs(['node', 'torl-cli', 'file.torrent', '-o', '/tmp/downloads']);
    assert.strictEqual(options.output, '/tmp/downloads');
  });

  it('parses --quiet flag', () => {
    const options = parseArgs(['node', 'torl-cli', 'file.torrent', '--quiet']);
    assert.strictEqual(options.quiet, true);
  });

  it('parses --help flag', () => {
    const options = parseArgs(['node', 'torl-cli', '--help']);
    assert.strictEqual(options.help, true);
  });

  it('parses --version flag', () => {
    const options = parseArgs(['node', 'torl-cli', '--version']);
    assert.strictEqual(options.version, true);
  });

  it('parses --concurrency option', () => {
    const options = parseArgs(['node', 'torl-cli', 'a.torrent', 'b.torrent', '--concurrency', '2']);
    assert.strictEqual(options.concurrency, 2);
  });

  it('parses -c shorthand', () => {
    const options = parseArgs(['node', 'torl-cli', 'a.torrent', '-c', '3']);
    assert.strictEqual(options.concurrency, 3);
  });

  it('throws on invalid concurrency', () => {
    assert.throws(() => parseArgs(['node', 'torl-cli', 'a.torrent', '-c', '0']), /Invalid concurrency/);
    assert.throws(() => parseArgs(['node', 'torl-cli', 'a.torrent', '-c', 'abc']), /Invalid concurrency/);
  });

  it('throws on missing concurrency value', () => {
    assert.throws(() => parseArgs(['node', 'torl-cli', 'a.torrent', '-c']), /requires a value/);
  });

  it('throws on unknown option', () => {
    assert.throws(() => parseArgs(['node', 'torl-cli', '--unknown']), /Unknown option/);
  });

  it('throws on missing --output value', () => {
    assert.throws(() => parseArgs(['node', 'torl-cli', 'file.torrent', '--output']), /requires a value/);
  });

  it('returns usage text', () => {
    assert.ok(getUsage().includes('Usage: torl-cli'));
  });

  it('parses --json flag', () => {
    const options = parseArgs(['node', 'torl-cli', 'file.torrent', '--json']);
    assert.strictEqual(options.json, true);
  });

  it('defaults to anacrolix and retains the bounded Node rollback', () => {
    assert.equal(selectDownloadEngine({}, {}), 'anacrolix');
    assert.equal(selectDownloadEngine({}, { TORL_DOWNLOAD_ENGINE: 'node' }), 'node');
    assert.equal(selectDownloadEngine({}, { TORL_DOWNLOAD_ENGINE: 'anything-else' }), 'anacrolix');
  });

  it('rejects --json and --quiet together', async () => {
    await assert.rejects(
      run(['node', 'torl-cli', 'file.torrent', '--json', '--quiet']),
      /Cannot use --json and --quiet together/
    );
  });

  it('does not start work for an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const pending = _run({
      inputs: ['magnet:?xt=urn:btih:1234567890abcdef1234567890abcdef12345678'],
      concurrency: 1,
      quiet: true,
      json: false,
      engine: 'node',
      signal: controller.signal
    }, null);

    await assert.doesNotReject(pending);
  });
});
