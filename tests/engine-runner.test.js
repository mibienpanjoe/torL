'use strict';

import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it } from 'node:test';
import { runEngine } from '../src/engine-runner.js';

function fakeProcess() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => child.emit('close', 0, 'SIGTERM');
  return child;
}

describe('anacrolix engine runner', () => {
  it('uses argv and relays JSON events', async () => {
    const child = fakeProcess();
    const calls = [];
    const events = [];
    const pending = runEngine('file name.torrent', { output: '/tmp/out' }, event => events.push(event), {
      findBinary: () => '/tmp/torl-tui',
      spawn: (binary, args, options) => {
        calls.push({ binary, args, options });
        return child;
      }
    });
    child.stdout.write('{"type":"start","id":"file name.torrent","name":"file","total":4}\n');
    child.stdout.write('{"type":"complete","id":"file name.torrent","path":"/tmp/out/file"}\n');
    child.emit('close', 0, null);

    assert.equal(await pending, '/tmp/out/file');
    assert.deepEqual(calls[0].args, ['--engine-json', '--id', 'file name.torrent', '-o', '/tmp/out', 'file name.torrent']);
    assert.equal(calls[0].options.shell, false);
    assert.deepEqual(events.map(event => event.type), ['start', 'complete']);
  });

  it('rejects malformed engine output', async () => {
    const child = fakeProcess();
    const pending = runEngine('file.torrent', { output: '/tmp/out' }, () => {}, {
      findBinary: () => '/tmp/torl-tui',
      spawn: () => child
    });
    child.stdout.write('not-json\n');
    await assert.rejects(pending, /invalid JSON event/);
  });

  it('forwards cancellation to the child', async () => {
    const child = fakeProcess();
    let killed = false;
    child.kill = signal => {
      killed = signal === 'SIGTERM';
      child.emit('close', 0, signal);
    };
    const controller = new AbortController();
    const pending = runEngine('file.torrent', { output: '/tmp/out', signal: controller.signal }, () => {}, {
      findBinary: () => '/tmp/torl-tui',
      spawn: () => child
    });
    controller.abort();
    await pending;
    assert.equal(killed, true);
  });
});
