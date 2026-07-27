'use strict';

import dgram from 'dgram';
import http from 'http';
import { URL } from 'url';
import { networkInterfaces } from 'os';

const SSDP_MULTICAST = '239.255.255.250';
const SSDP_PORT = 1900;

const UPNP_SERVICE_WAN_IP_CONNECTION = 'urn:schemas-upnp-org:service:WANIPConnection:1';
const UPNP_SERVICE_WAN_PPP_CONNECTION = 'urn:schemas-upnp-org:service:WANPPPConnection:1';

export async function discoverUPnPGateway(options = {}) {
  const address = options.ssdpAddress || SSDP_MULTICAST;
  const port = options.ssdpPort || SSDP_PORT;
  const timeout = options.timeout || 3000;
  const socket = dgram.createSocket('udp4');
  const responses = [];

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      resolve(responses.length > 0 ? responses[0] : null);
    }, timeout);

    socket.on('message', (msg, rinfo) => {
      const text = msg.toString('utf8');
      const location = parseHeader(text, 'LOCATION');
      if (location) {
        responses.push({ location, address: rinfo.address });
      }
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.bind(() => {
      const message = buildSSDPMessage(address, port);
      socket.send(message, 0, message.length, port, address, (err) => {
        if (err) {
          clearTimeout(timer);
          socket.close();
          reject(err);
        }
      });
    });
  });
}

function buildSSDPMessage(address, port) {
  return Buffer.from([
    'M-SEARCH * HTTP/1.1',
    `HOST: ${address}:${port}`,
    'MAN: "ssdp:discover"',
    'MX: 3',
    `ST: ${UPNP_SERVICE_WAN_IP_CONNECTION}`,
    '',
    ''
  ].join('\r\n'));
}

function parseHeader(text, name) {
  const match = text.match(new RegExp(`^${name}:\\s*(.+)$`, 'mi'));
  return match ? match[1].trim() : null;
}

export async function fetchUPnPControlUrl(location) {
  const response = await fetch(location);
  const xml = await response.text();
  const baseUrl = new URL(location);
  return parseControlUrl(xml, baseUrl);
}

export function parseControlUrl(xml, baseUrl) {
  const serviceType = findServiceType(xml);
  if (!serviceType) return null;
  const controlUrl = extractTag(xml, 'controlURL');
  if (!controlUrl) return null;
  return new URL(controlUrl, baseUrl).toString();
}

function findServiceType(xml) {
  if (xml.includes(UPNP_SERVICE_WAN_IP_CONNECTION)) return UPNP_SERVICE_WAN_IP_CONNECTION;
  if (xml.includes(UPNP_SERVICE_WAN_PPP_CONNECTION)) return UPNP_SERVICE_WAN_PPP_CONNECTION;
  return null;
}

function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`, 'i'));
  return match ? match[1].trim() : null;
}

export async function addPortMappingUPnP(controlUrl, internalClient, internalPort, externalPort, protocol, leaseDuration) {
  const serviceType = controlUrl.includes('WANPPPConnection') ? UPNP_SERVICE_WAN_PPP_CONNECTION : UPNP_SERVICE_WAN_IP_CONNECTION;
  const soapAction = `${serviceType}#AddPortMapping`;
  const body = buildAddPortMappingSoap(serviceType, internalClient, internalPort, externalPort, protocol, leaseDuration);

  const response = await fetch(controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPAction': `"${soapAction}"`
    },
    body
  });

  if (!response.ok) return null;
  const text = await response.text();
  return text.includes('AddPortMappingResponse') ? true : null;
}

function buildAddPortMappingSoap(serviceType, internalClient, internalPort, externalPort, protocol, leaseDuration) {
  return `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:AddPortMapping xmlns:u="${serviceType}">
      <NewRemoteHost></NewRemoteHost>
      <NewExternalPort>${externalPort}</NewExternalPort>
      <NewProtocol>${protocol}</NewProtocol>
      <NewInternalPort>${internalPort}</NewInternalPort>
      <NewInternalClient>${internalClient}</NewInternalClient>
      <NewEnabled>1</NewEnabled>
      <NewPortMappingDescription>torl</NewPortMappingDescription>
      <NewLeaseDuration>${leaseDuration}</NewLeaseDuration>
    </u:AddPortMapping>
  </s:Body>
</s:Envelope>`;
}

export async function deletePortMappingUPnP(controlUrl, externalPort, protocol) {
  const serviceType = controlUrl.includes('WANPPPConnection') ? UPNP_SERVICE_WAN_PPP_CONNECTION : UPNP_SERVICE_WAN_IP_CONNECTION;
  const soapAction = `${serviceType}#DeletePortMapping`;
  const body = `<?xml version="1.0"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">
  <s:Body>
    <u:DeletePortMapping xmlns:u="${serviceType}">
      <NewRemoteHost></NewRemoteHost>
      <NewExternalPort>${externalPort}</NewExternalPort>
      <NewProtocol>${protocol}</NewProtocol>
    </u:DeletePortMapping>
  </s:Body>
</s:Envelope>`;

  const response = await fetch(controlUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/xml; charset="utf-8"',
      'SOAPAction': `"${soapAction}"`
    },
    body
  });

  if (!response.ok) return null;
  const text = await response.text();
  return text.includes('DeletePortMappingResponse') ? true : null;
}

export function getInternalIp() {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

export async function mapPortUPnP(internalPort, externalPort, protocol, leaseDuration, options = {}) {
  const gateway = await discoverUPnPGateway(options);
  if (!gateway) return null;
  const controlUrl = await fetchUPnPControlUrl(gateway.location);
  if (!controlUrl) return null;
  const internalClient = getInternalIp();
  const success = await addPortMappingUPnP(controlUrl, internalClient, internalPort, externalPort, protocol, leaseDuration);
  if (!success) return null;
  return { protocol, internalPort, externalPort, internalClient, controlUrl, method: 'upnp' };
}

export async function unmapPortUPnP(mapping) {
  if (!mapping || !mapping.controlUrl) return null;
  return deletePortMappingUPnP(mapping.controlUrl, mapping.externalPort, mapping.protocol);
}

// --- NAT-PMP ---

const NATPMP_PORT = 5351;

function getDefaultGateway() {
  const interfaces = networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const parts = iface.address.split('.');
        parts[3] = '1';
        return parts.join('.');
      }
    }
  }
  return '127.0.0.1';
}

export function natPmpOpcode(protocol) {
  return protocol === 'UDP' ? 1 : 2;
}

export function encodeNatPmpMapRequest(protocol, internalPort, externalPort, lifetime) {
  const opcode = natPmpOpcode(protocol);
  const buf = Buffer.alloc(12);
  buf.writeUInt8(0, 0); // version
  buf.writeUInt8(opcode, 1);
  buf.writeUInt16BE(0, 2); // reserved
  buf.writeUInt16BE(internalPort, 4);
  buf.writeUInt16BE(externalPort, 6);
  buf.writeUInt32BE(lifetime, 8);
  return buf;
}

export function parseNatPmpMapResponse(buf) {
  if (buf.length < 12) return null;
  const version = buf.readUInt8(0);
  const opcode = buf.readUInt8(1);
  const result = buf.readUInt16BE(2);
  const seconds = buf.readUInt32BE(4);
  const internalPort = buf.readUInt16BE(8);
  const externalPort = buf.readUInt16BE(10);
  const lifetime = buf.readUInt32BE(12);
  return {
    version,
    opcode,
    result,
    seconds,
    internalPort,
    externalPort,
    lifetime,
    success: version === 0 && result === 0 && (opcode === 129 || opcode === 130)
  };
}

export async function mapPortNatPMP(internalPort, externalPort, protocol, lifetime, options = {}) {
  const gateway = options.gateway || getDefaultGateway();
  const port = options.port || NATPMP_PORT;
  const timeout = options.timeout || 3000;
  const request = encodeNatPmpMapRequest(protocol, internalPort, externalPort, lifetime);

  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => {
      socket.close();
      resolve(null);
    }, timeout);

    socket.on('error', (err) => {
      clearTimeout(timer);
      socket.close();
      reject(err);
    });

    socket.on('message', (msg) => {
      clearTimeout(timer);
      socket.close();
      const response = parseNatPmpMapResponse(msg);
      if (response && response.success) {
        resolve({
          protocol,
          internalPort: response.internalPort,
          externalPort: response.externalPort,
          lifetime: response.lifetime,
          gateway,
          port,
          method: 'natpmp'
        });
      } else {
        resolve(null);
      }
    });

    socket.bind(() => {
      socket.send(request, 0, request.length, port, gateway, (err) => {
        if (err) {
          clearTimeout(timer);
          socket.close();
          reject(err);
        }
      });
    });
  });
}

export async function unmapPortNatPMP(mapping) {
  if (!mapping || !mapping.gateway) return null;
  const result = await mapPortNatPMP(mapping.internalPort, 0, mapping.protocol, 0, {
    gateway: mapping.gateway,
    port: mapping.port,
    timeout: 3000
  });
  return result !== null;
}

// --- Unified API ---

export async function mapPort(internalPort, externalPort, protocol, leaseDuration, options = {}) {
  const upnpMapping = await mapPortUPnP(internalPort, externalPort, protocol, leaseDuration, options);
  if (upnpMapping) return upnpMapping;

  const natPmpMapping = await mapPortNatPMP(internalPort, externalPort, protocol, leaseDuration, options);
  if (natPmpMapping) return natPmpMapping;

  return null;
}

export async function unmapPort(mapping) {
  if (!mapping) return null;
  if (mapping.method === 'upnp') return unmapPortUPnP(mapping);
  if (mapping.method === 'natpmp') return unmapPortNatPMP(mapping);
  return null;
}
