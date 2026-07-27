'use strict';

import http from 'http';
import dgram from 'dgram';

const UPNP_SERVICE_WAN_IP_CONNECTION = 'urn:schemas-upnp-org:service:WANIPConnection:1';

export function createMockUPnPGateway(options = {}) {
  const descriptionPath = options.descriptionPath || '/igd.xml';
  const controlPath = options.controlPath || '/upnp/control/WANIPConn1';
  const ssdpPort = options.ssdpPort || 0;

  let httpPort = null;
  const mappings = [];

  const httpServer = http.createServer((req, res) => {
    if (req.url === descriptionPath) {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(`<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0">
  <device>
    <deviceType>urn:schemas-upnp-org:device:InternetGatewayDevice:1</deviceType>
    <serviceList>
      <service>
        <serviceType>${UPNP_SERVICE_WAN_IP_CONNECTION}</serviceType>
        <controlURL>${controlPath}</controlURL>
      </service>
    </serviceList>
  </device>
</root>`);
      return;
    }

    if (req.url === controlPath) {
      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', () => {
        if (body.includes('AddPortMapping')) {
          const externalPort = extractSoapValue(body, 'NewExternalPort');
          const protocol = extractSoapValue(body, 'NewProtocol');
          const internalClient = extractSoapValue(body, 'NewInternalClient');
          const internalPort = extractSoapValue(body, 'NewInternalPort');
          mappings.push({ externalPort, protocol, internalClient, internalPort });
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:AddPortMappingResponse xmlns:u="${UPNP_SERVICE_WAN_IP_CONNECTION}"/>
  </s:Body>
</s:Envelope>`);
        } else if (body.includes('DeletePortMapping')) {
          const externalPort = extractSoapValue(body, 'NewExternalPort');
          const protocol = extractSoapValue(body, 'NewProtocol');
          const idx = mappings.findIndex(m => m.externalPort === externalPort && m.protocol === protocol);
          if (idx !== -1) mappings.splice(idx, 1);
          res.writeHead(200, { 'Content-Type': 'text/xml' });
          res.end(`<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Body>
    <u:DeletePortMappingResponse xmlns:u="${UPNP_SERVICE_WAN_IP_CONNECTION}"/>
  </s:Body>
</s:Envelope>`);
        } else {
          res.writeHead(500);
          res.end('Unknown action');
        }
      });
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  const ssdpSocket = dgram.createSocket('udp4');
  ssdpSocket.on('message', (msg, rinfo) => {
    const text = msg.toString('utf8');
    if (text.includes('M-SEARCH')) {
      const location = `http://127.0.0.1:${httpPort}${descriptionPath}`;
      const response = [
        'HTTP/1.1 200 OK',
        `LOCATION: ${location}`,
        'SERVER: torl-mock/1.0 UPnP/1.0',
        'ST: ' + UPNP_SERVICE_WAN_IP_CONNECTION,
        '',
        ''
      ].join('\r\n');
      ssdpSocket.send(response, 0, response.length, rinfo.port, rinfo.address);
    }
  });

  return new Promise((resolve, reject) => {
    httpServer.on('error', reject);
    ssdpSocket.on('error', reject);

    httpServer.listen(0, '127.0.0.1', () => {
      httpPort = httpServer.address().port;
      ssdpSocket.bind(ssdpPort, '127.0.0.1', () => {
        const actualSsdpPort = ssdpSocket.address().port;
        let closed = false;
        resolve({
          httpPort,
          ssdpPort: actualSsdpPort,
          controlUrl: `http://127.0.0.1:${httpPort}${controlPath}`,
          getMappings: () => mappings,
          close: () => {
            if (!closed) {
              closed = true;
              httpServer.close();
              ssdpSocket.close();
            }
          }
        });
      });
    });
  });
}

function extractSoapValue(body, name) {
  const match = body.match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i'));
  return match ? match[1] : null;
}
