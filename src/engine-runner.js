'use strict';

import { spawn as spawnChild } from 'node:child_process';
import { findBinary } from './tui-launcher.js';

const MAX_DIAGNOSTIC_LENGTH = 4096;
const MAX_EVENT_BUFFER_LENGTH = 1024 * 1024;

function sanitizeDiagnostic(message) {
  return message.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_DIAGNOSTIC_LENGTH);
}

export function runEngine(input, options, onEvent, dependencies = {}) {
  const locateBinary = dependencies.findBinary ?? findBinary;
  const spawn = dependencies.spawn ?? spawnChild;
  const binary = locateBinary();
  if (!binary) {
    return Promise.reject(new Error('torl-tui binary not found; run npm run build-tui or reinstall torl-client'));
  }

  return new Promise((resolve, reject) => {
    const args = ['--engine-json', '--id', input, '-o', options.output, input];
    const child = spawn(binary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
      shell: false
    });
    let stdout = '';
    let stderr = '';
    let completePath = null;
    let engineError = null;
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      options.signal?.removeEventListener('abort', abort);
      if (err) reject(err);
      else resolve(value);
    };

    const handleLine = line => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        finish(new Error('anacrolix engine emitted an invalid JSON event'));
        child.kill('SIGTERM');
        return;
      }
      if (!event || typeof event.type !== 'string' || event.id !== input) {
        finish(new Error('anacrolix engine emitted an invalid event'));
        child.kill('SIGTERM');
        return;
      }
      if (event.type === 'complete') {
        if (typeof event.path !== 'string' || event.path.length === 0) {
          finish(new Error('anacrolix engine emitted an invalid completion event'));
          child.kill('SIGTERM');
          return;
        }
        completePath = event.path;
      }
      if (event.type === 'error' && typeof event.message === 'string') engineError = sanitizeDiagnostic(event.message);
      try {
        onEvent(event);
      } catch (err) {
        finish(err);
        child.kill('SIGTERM');
      }
    };

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      stdout += chunk;
      if (stdout.length > MAX_EVENT_BUFFER_LENGTH) {
        finish(new Error('anacrolix engine event exceeded the size limit'));
        child.kill('SIGTERM');
        return;
      }
      const lines = stdout.split('\n');
      stdout = lines.pop();
      for (const line of lines) handleLine(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr = (stderr + chunk).slice(-MAX_DIAGNOSTIC_LENGTH);
    });
    child.on('error', err => finish(new Error(`unable to start anacrolix engine: ${sanitizeDiagnostic(err.message)}`)));
    child.on('close', code => {
      if (stdout.trim()) handleLine(stdout);
      if (settled) return;
      if (options.signal?.aborted && code === 0) {
        finish(null, completePath);
      } else if (code !== 0 || !completePath) {
        const message = engineError || sanitizeDiagnostic(stderr) || `anacrolix engine exited with code ${code}`;
        finish(new Error(message));
      } else {
        finish(null, completePath);
      }
    });

    function abort() {
      child.kill('SIGTERM');
    }
    if (options.signal?.aborted) abort();
    else options.signal?.addEventListener('abort', abort, { once: true });
  });
}
