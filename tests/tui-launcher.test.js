import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { runTui } from '../src/tui-launcher.js';

describe('tui launcher', () => {
  it('launches the TUI when no download input is provided', () => {
    const calls = [];

    const status = runTui([], {
      findBinary: () => '/tmp/torl-tui',
      spawn: (binary, args, options) => {
        calls.push({ binary, args, options });
        return { status: 0 };
      },
      writeOut: () => {},
      writeErr: () => {}
    });

    assert.equal(status, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].binary, '/tmp/torl-tui');
    assert.deepEqual(calls[0].args, []);
    assert.equal(calls[0].options.stdio, 'inherit');
  });

  it('shows help without starting the TUI', () => {
    let spawned = false;
    let output = '';

    const status = runTui(['--help'], {
      findBinary: () => '/tmp/torl-tui',
      spawn: () => {
        spawned = true;
        return { status: 0 };
      },
      writeOut: message => { output = message; },
      writeErr: () => {}
    });

    assert.equal(status, 0);
    assert.equal(spawned, false);
    assert.match(output, /torl \[options\] \[torrent-file\|magnet-link/);
  });
});
