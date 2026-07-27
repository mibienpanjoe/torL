'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  discoverUPnPGateway,
  fetchUPnPControlUrl,
  parseControlUrl,
  addPortMappingUPnP,
  deletePortMappingUPnP,
  mapPortUPnP,
  unmapPortUPnP,
  encodeNatPmpMapRequest,
  parseNatPmpMapResponse,
  mapPortNatPMP,
  unmapPortNatPMP,
  mapPort,
  unmapPort
} from '../src/nat.js';
import { createMockUPnPGateway } from './mocks/upnp-gateway.js';
import { createMockNatPMPGateway } from './mocks/natpmp-gateway.js';

describe('nat', () => {
  describe('UPnP', () => {
    it('discovers a mock UPnP gateway via SSDP', async () => {
      const gateway = await createMockUPnPGateway();
      try {
        const discovered = await discoverUPnPGateway({
          ssdpAddress: '127.0.0.1',
          ssdpPort: gateway.ssdpPort,
          timeout: 1000
        });
        assert.ok(discovered);
        assert.strictEqual(discovered.location, `http://127.0.0.1:${gateway.httpPort}/igd.xml`);
      } finally {
        gateway.close();
      }
    });

    it('parses the control URL from the description XML', async () => {
      const gateway = await createMockUPnPGateway();
      try {
        const discovered = await discoverUPnPGateway({
          ssdpAddress: '127.0.0.1',
          ssdpPort: gateway.ssdpPort,
          timeout: 1000
        });
        const controlUrl = await fetchUPnPControlUrl(discovered.location);
        assert.strictEqual(controlUrl, gateway.controlUrl);
      } finally {
        gateway.close();
      }
    });

    it('parses the control URL from XML directly', () => {
      const xml = `<?xml version="1.0"?>
<root>
  <service>
    <serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>
    <controlURL>/ctl</controlURL>
  </service>
</root>`;
      const controlUrl = parseControlUrl(xml, new URL('http://127.0.0.1:8080/igd.xml'));
      assert.strictEqual(controlUrl, 'http://127.0.0.1:8080/ctl');
    });

    it('returns null for unsupported service XML', () => {
      const xml = `<?xml version="1.0"?>
<root>
  <service>
    <serviceType>urn:schemas-upnp-org:service:Unknown:1</serviceType>
    <controlURL>/ctl</controlURL>
  </service>
</root>`;
      const controlUrl = parseControlUrl(xml, new URL('http://127.0.0.1:8080/igd.xml'));
      assert.strictEqual(controlUrl, null);
    });

    it('adds and deletes a port mapping through the mock gateway', async () => {
      const gateway = await createMockUPnPGateway();
      try {
        const discovered = await discoverUPnPGateway({
          ssdpAddress: '127.0.0.1',
          ssdpPort: gateway.ssdpPort,
          timeout: 1000
        });
        const controlUrl = await fetchUPnPControlUrl(discovered.location);
        const added = await addPortMappingUPnP(controlUrl, '127.0.0.1', 6881, 6881, 'TCP', 3600);
        assert.strictEqual(added, true);
        assert.strictEqual(gateway.getMappings().length, 1);
        assert.strictEqual(gateway.getMappings()[0].externalPort, '6881');

        const deleted = await deletePortMappingUPnP(controlUrl, 6881, 'TCP');
        assert.strictEqual(deleted, true);
        assert.strictEqual(gateway.getMappings().length, 0);
      } finally {
        gateway.close();
      }
    });

    it('maps and unmaps a port end-to-end', async () => {
      const gateway = await createMockUPnPGateway();
      try {
        const mapping = await mapPortUPnP(6881, 6881, 'TCP', 3600, {
          ssdpAddress: '127.0.0.1',
          ssdpPort: gateway.ssdpPort,
          timeout: 1000
        });
        assert.ok(mapping);
        assert.strictEqual(mapping.method, 'upnp');
        assert.strictEqual(mapping.externalPort, 6881);
        assert.strictEqual(gateway.getMappings().length, 1);

        const deleted = await unmapPortUPnP(mapping);
        assert.strictEqual(deleted, true);
        assert.strictEqual(gateway.getMappings().length, 0);
      } finally {
        gateway.close();
      }
    });
  });

  describe('NAT-PMP', () => {
    it('encodes and parses a map request/response', () => {
      const request = encodeNatPmpMapRequest('TCP', 6881, 6881, 3600);
      assert.strictEqual(request.length, 12);
      assert.strictEqual(request.readUInt8(1), 2);
      const response = Buffer.alloc(16);
      response.writeUInt8(0, 0);
      response.writeUInt8(130, 1);
      response.writeUInt16BE(0, 2);
      response.writeUInt32BE(0, 4);
      response.writeUInt16BE(6881, 8);
      response.writeUInt16BE(6881, 10);
      response.writeUInt32BE(3600, 12);
      const parsed = parseNatPmpMapResponse(response);
      assert.ok(parsed.success);
      assert.strictEqual(parsed.internalPort, 6881);
      assert.strictEqual(parsed.externalPort, 6881);
    });

    it('maps and unmaps a port through a mock NAT-PMP gateway', async () => {
      const gateway = await createMockNatPMPGateway();
      try {
        const mapping = await mapPortNatPMP(6881, 6881, 'TCP', 3600, {
          gateway: '127.0.0.1',
          port: gateway.port,
          timeout: 1000
        });
        assert.ok(mapping);
        assert.strictEqual(mapping.method, 'natpmp');
        assert.strictEqual(gateway.getMappings().length, 1);

        const deleted = await unmapPortNatPMP(mapping);
        assert.strictEqual(deleted, true);
        assert.strictEqual(gateway.getMappings().length, 0);
      } finally {
        gateway.close();
      }
    });
  });

  describe('Unified API', () => {
    it('tries UPnP first then NAT-PMP', async () => {
      const natPmpGateway = await createMockNatPMPGateway();
      try {
        const mapping = await mapPort(6881, 6881, 'TCP', 3600, {
          ssdpAddress: '127.0.0.1',
          ssdpPort: 1, // no UPnP gateway at this port
          gateway: '127.0.0.1',
          port: natPmpGateway.port,
          timeout: 100
        });
        assert.ok(mapping);
        assert.strictEqual(mapping.method, 'natpmp');
        const deleted = await unmapPort(mapping);
        assert.strictEqual(deleted, true);
      } finally {
        natPmpGateway.close();
      }
    });

    it('uses UPnP when available', async () => {
      const upnpGateway = await createMockUPnPGateway();
      try {
        const mapping = await mapPort(6881, 6881, 'TCP', 3600, {
          ssdpAddress: '127.0.0.1',
          ssdpPort: upnpGateway.ssdpPort,
          timeout: 1000
        });
        assert.ok(mapping);
        assert.strictEqual(mapping.method, 'upnp');
        const deleted = await unmapPort(mapping);
        assert.strictEqual(deleted, true);
      } finally {
        upnpGateway.close();
      }
    });
  });
});
