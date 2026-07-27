'use strict';

import dgram from 'dgram';

export function createMockNatPMPGateway(options = {}) {
  const port = options.port || 0;
  const mappings = [];

  const socket = dgram.createSocket('udp4');
  socket.on('message', (msg, rinfo) => {
    if (msg.length < 12) return;
    const version = msg.readUInt8(0);
    const opcode = msg.readUInt8(1);
    const internalPort = msg.readUInt16BE(4);
    const externalPort = msg.readUInt16BE(6);
    const lifetime = msg.readUInt32BE(8);

    if (version !== 0 || (opcode !== 1 && opcode !== 2)) return;

    const responseOpcode = 128 + opcode;
    const actualExternalPort = lifetime === 0 ? 0 : (externalPort || 12345);
    const actualLifetime = lifetime === 0 ? 0 : (lifetime || 3600);

    const idx = mappings.findIndex(m => m.internalPort === internalPort && m.protocol === responseOpcode);
    if (idx !== -1) mappings.splice(idx, 1);
    if (lifetime !== 0) {
      mappings.push({ internalPort, externalPort: actualExternalPort, protocol: responseOpcode });
    }

    const response = Buffer.alloc(16);
    response.writeUInt8(0, 0);
    response.writeUInt8(responseOpcode, 1);
    response.writeUInt16BE(0, 2); // result
    response.writeUInt32BE(0, 4); // seconds since start
    response.writeUInt16BE(internalPort, 8);
    response.writeUInt16BE(actualExternalPort, 10);
    response.writeUInt32BE(actualLifetime, 12);
    socket.send(response, 0, response.length, rinfo.port, rinfo.address);
  });

  return new Promise((resolve, reject) => {
    socket.on('error', reject);
    socket.bind(port, '127.0.0.1', () => {
      const actualPort = socket.address().port;
      let closed = false;
      resolve({
        port: actualPort,
        getMappings: () => mappings,
        close: () => {
          if (!closed) {
            closed = true;
            socket.close();
          }
        }
      });
    });
  });
}
