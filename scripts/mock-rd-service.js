/**
 * 🍶 Mahavishnu Wines - Biometric Emulator for MacOS
 * ─────────────────────────────────────────────────────────────────
 * This script mimics a real CSD200 RD Service on port 11100.
 * Use this to test attendance logic on your Mac without hardware.
 * ─────────────────────────────────────────────────────────────────
 * Run: node scripts/mock-rd-service.js
 */

const http = require('http');
const url = require('url');

const PORT = 11100;

// Mock ISO templates for testing (Minutiae-heavy strings)
const MOCK_TEMPLATES = {
  admin: "Rk1SACAyMAAAAAAAAcAAAABAAAAAAAMAAAAMAAAAIA==", // Mock base64
  cashier: "Rk1SACAyMAAAAAAAAcAAAABAAAAAAAMAAAAMAAAAIA==",
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DEVICEINFO, CAPTURE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  console.log(`[MOCK-RD] ${req.method} ${req.url}`);

  // 1. DEVICEINFO Request
  if (req.method === 'DEVICEINFO' || (req.method === 'GET' && parsedUrl.pathname === '/rd/info')) {
    const xml = `<?xml version="1.0" encoding="UTF-8"?><DeviceInfo dpId="PRECISION.CSD200" rdsId="MOCK_RD" rdsVer="2.0.0" mi="CS-200" mc="MOCK_CERT" dc="MOCK_DC"><additional_info><Param name="device_serial" value="MOCK12345678"/></additional_info></DeviceInfo>`;
    res.writeHead(200, { 'Content-Type': 'text/xml' });
    res.end(xml);
    return;
  }

  // 2. CAPTURE Request
  if (req.method === 'CAPTURE' || (req.method === 'POST' && parsedUrl.pathname === '/rd/capture')) {
    console.log('Fingerprint requested! Providing "Admin" mock scan...');
    
    // In a real mock, we could pop up a prompt, but for now we just return a success block
    const xml = `
    <PidData>
      <Resp errCode="0" errInfo="Success" fCount="1" fType="0" iCount="0" pCount="0" nmPoints="15" qScore="85" />
      <Data type="X">${MOCK_TEMPLATES.admin}</Data>
      <Hmac>MOCK_HMAC</Hmac>
    </PidData>`.trim();
    
    // Simulate capture delay
    setTimeout(() => {
      res.writeHead(200, { 'Content-Type': 'text/xml' });
      res.end(xml);
    }, 1200);
    return;
  }

  res.writeHead(404);
  res.end('Mock service only supports DEVICEINFO and CAPTURE');
});

server.listen(PORT, '127.0.0.1', () => {
  console.log('──────────────────────────────────────────────────');
  console.log('🍶 Mahavishnu Wines Biometric Mock Server Active');
  console.log(`🛰️  Listening on http://127.0.0.1:${PORT}`);
  console.log('🚀 Ready to simulate CSD200 scans on your Mac!');
  console.log('──────────────────────────────────────────────────');
});
