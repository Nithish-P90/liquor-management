/**
 * CSD 200 Fingerprint Bridge — macOS
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs as a standalone process. Talks to the physical Precision CSD200 USB
 * device and exposes the same HTTP API the Next.js app already expects:
 *
 *   DEVICEINFO http://127.0.0.1:11100/rd/info    → device identity XML
 *   CAPTURE    http://127.0.0.1:11100/rd/capture  → PID XML with ISO template
 *
 * Start:  node scripts/fingerprint-bridge.js
 * List devices (with scanner plugged in):  node scripts/fingerprint-bridge.js --list
 * Probe mode (debug unknown device):       node scripts/fingerprint-bridge.js --probe
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict'

const HID  = require('node-hid')
const http = require('http')

// ── Device Config ────────────────────────────────────────────────────────────
// Run with --list to find your device's exact IDs, then update these.
//
// Precision Biometric India devices commonly use:
//   VID 0x04b4 (Cypress Semiconductor) or 0x058f (Alcor) or 0x1c7a (LighTuning)
//
// If your device is on a different VID/PID, --list will show all connected HID
// devices so you can identify the right one.
const DEVICE_CONFIG = {
  // Leave as null to auto-detect first fingerprint-looking HID device,
  // or set explicit values after running --list
  vendorId:  null,   // e.g. 0x04b4
  productId: null,   // e.g. 0x0100
}

// Allow overriding the listening port via environment (FP_BRIDGE_PORT or PORT)
const PORT = Number(process.env.FP_BRIDGE_PORT || process.env.PORT || 11100)
const CAPTURE_TIMEOUT_MS = 12_000  // how long to wait for a finger

// ── Known fingerprint device profiles ───────────────────────────────────────
// Add more as we discover them. The bridge tries each matching profile.
const KNOWN_PROFILES = [
  // Precision CSD200 / CS-200
  { name: 'Precision CSD200', vendorId: 0x04b4, productId: 0x0100,
    cmdCapture: [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    cmdCancel:  [0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    reportSize: 64 },

  // Mantra MFS100 (fallback compatibility)
  { name: 'Mantra MFS100', vendorId: 0x2609, productId: 0x0002,
    cmdCapture: [0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    cmdCancel:  [0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    reportSize: 64 },

  // SecuGen Hamster Pro 20
  { name: 'SecuGen Hamster Pro 20', vendorId: 0x1162, productId: 0x0320,
    cmdCapture: [0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
    cmdCancel:  [0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00],
    reportSize: 64 },
]

// ── Utility: --list mode ─────────────────────────────────────────────────────
if (process.argv.includes('--list')) {
  console.log('\n══ Connected HID Devices ══════════════════════════════════════\n')
  const devices = HID.devices()
  if (devices.length === 0) {
    console.log('No HID devices found. Make sure the scanner is plugged in.\n')
    process.exit(0)
  }
  devices
    .filter(d => d.vendorId && d.productId)
    .sort((a, b) => (a.manufacturer || '').localeCompare(b.manufacturer || ''))
    .forEach(d => {
      const vid = `0x${d.vendorId.toString(16).padStart(4, '0').toUpperCase()}`
      const pid = `0x${d.productId.toString(16).padStart(4, '0').toUpperCase()}`
      console.log(`  VID:${vid}  PID:${pid}  │  ${d.manufacturer ?? '—'} ${d.product ?? '—'}`)
      if (d.serialNumber) console.log(`              serial: ${d.serialNumber}`)
      console.log()
    })
  console.log('Update DEVICE_CONFIG in scripts/fingerprint-bridge.js with the VID/PID above.\n')
  process.exit(0)
}

// ── Utility: --probe mode ────────────────────────────────────────────────────
// Sends common capture commands and prints raw HID reports — helps identify
// the device protocol without vendor documentation.
if (process.argv.includes('--probe')) {
  probeDevice()
  process.on('SIGINT', () => { console.log('\nProbe ended.'); process.exit(0) })
  return
}

// ── Device detection ─────────────────────────────────────────────────────────
function findDevice() {
  const allDevices = HID.devices()

  // 1. Try explicit config first
  if (DEVICE_CONFIG.vendorId && DEVICE_CONFIG.productId) {
    const found = allDevices.find(
      d => d.vendorId === DEVICE_CONFIG.vendorId && d.productId === DEVICE_CONFIG.productId
    )
    if (found) return { device: found, profile: null }
    console.error(`[bridge] Device VID:0x${DEVICE_CONFIG.vendorId.toString(16)} PID:0x${DEVICE_CONFIG.productId.toString(16)} not found.`)
    console.error('         Run --list to see connected devices.')
    return null
  }

  // 2. Try known profiles
  for (const profile of KNOWN_PROFILES) {
    const found = allDevices.find(
      d => d.vendorId === profile.vendorId && d.productId === profile.productId
    )
    if (found) {
      console.log(`[bridge] Found: ${profile.name}  VID:0x${profile.vendorId.toString(16)}  PID:0x${profile.productId.toString(16)}`)
      return { device: found, profile }
    }
  }

  // 3. Heuristic: any USB HID device with "fingerprint" or "biometric" in product name
  const guessed = allDevices.find(
    d => /finger|biometric|fp|scan/i.test(d.product ?? '') ||
         /mantra|precision|morpho|secugen|startek/i.test(d.manufacturer ?? '')
  )
  if (guessed) {
    console.log(`[bridge] Auto-detected: ${guessed.manufacturer ?? '?'} ${guessed.product ?? '?'}`)
    console.log(`         VID:0x${guessed.vendorId.toString(16)}  PID:0x${guessed.productId.toString(16)}`)
    console.log('         No known protocol for this device. Use --probe mode or set DEVICE_CONFIG explicitly.')
    return { device: guessed, profile: null }
  }

  return null
}

// ── Capture fingerprint via HID ──────────────────────────────────────────────
// Returns base64 ISO 19794-2 template, or throws on failure / timeout.
async function captureFromDevice() {
  return new Promise((resolve, reject) => {
    const info = findDevice()
    if (!info) {
      return reject(new Error('CSD200 scanner not detected. Plug in the device and try again.'))
    }

    let hid
    try {
      hid = new HID.HID(info.device.vendorId, info.device.productId)
    } catch (e) {
      return reject(new Error(`Cannot open HID device: ${e.message}. Try: sudo chmod a+rw /dev/usb/hiddev*`))
    }

    const profile   = info.profile
    const reportBuf = []
    let   timer     = null

    function cleanup(err, result) {
      if (timer) clearTimeout(timer)
      try { if (hid) hid.close() } catch (_) {}
      if (err) reject(err)
      else     resolve(result)
    }

    hid.on('error', err => cleanup(new Error(`HID error: ${err.message}`)))

    hid.on('data', (data) => {
      // Each HID report is up to 64 bytes. Collect until we have a complete template.
      reportBuf.push(Buffer.from(data))

      // Try to assemble a complete ISO 19794-2 template from collected reports
      const template = tryAssembleTemplate(reportBuf)
      if (template) {
        cleanup(null, template)
      }
    })

    // Timeout
    timer = setTimeout(() => {
      cleanup(new Error('Capture timed out. No finger detected within 12 seconds.'))
    }, CAPTURE_TIMEOUT_MS)

    // Send capture command
    const cmdBytes = profile?.cmdCapture ?? [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
    const report   = Buffer.alloc(65, 0)  // 1 byte report ID + 64 bytes data
    report[0] = 0x00  // report ID (HID)
    cmdBytes.forEach((b, i) => { report[i + 1] = b })

    try {
      hid.write(Array.from(report))
      console.log('[bridge] Capture command sent — waiting for finger...')
    } catch (e) {
      cleanup(new Error(`Failed to send capture command: ${e.message}`))
    }
  })
}

// ── Template assembly from HID reports ──────────────────────────────────────
// ISO 19794-2 templates start with "FMR\0" (0x46 0x4D 0x52 0x00).
// They can be 100–1000+ bytes. HID reports are 64 bytes each so the template
// is often split across multiple reports.
function tryAssembleTemplate(reports) {
  const combined = Buffer.concat(reports)

  // Look for ISO 19794-2 magic bytes "FMR\0" anywhere in the buffer
  const fmrOffset = combined.indexOf(Buffer.from([0x46, 0x4D, 0x52, 0x00]))
  if (fmrOffset === -1) return null

  // After magic: bytes 8–9 are total record length (big-endian)
  if (combined.length < fmrOffset + 10) return null
  const recordLen = combined.readUInt16BE(fmrOffset + 8)
  if (recordLen < 28) return null  // minimum valid template

  // Check we have enough data
  if (combined.length < fmrOffset + recordLen) return null

  const templateBytes = combined.subarray(fmrOffset, fmrOffset + recordLen)
  return templateBytes.toString('base64')
}

// ── Probe mode ───────────────────────────────────────────────────────────────
function probeDevice() {
  const info = findDevice()
  if (!info) {
    console.error('[probe] No device found. Plug in the CSD200 and try again.')
    return
  }

  console.log(`[probe] Opening device: ${info.device.manufacturer ?? '?'} ${info.device.product ?? '?'}`)
  console.log('[probe] Watching for HID reports. Place finger on scanner...')
  console.log('[probe] Press Ctrl+C to stop.\n')

  const hid = new HID.HID(info.device.vendorId, info.device.productId)
  let reportCount = 0

  hid.on('data', data => {
    reportCount++
    const hex = Buffer.from(data).toString('hex').match(/.{2}/g).join(' ')
    console.log(`[probe] report #${reportCount}: ${hex}`)

    // Check for ISO template
    const buf = Buffer.from(data)
    if (buf[0] === 0x46 && buf[1] === 0x4D && buf[2] === 0x52 && buf[3] === 0x00) {
      console.log('[probe] *** ISO 19794-2 template detected! This device returns standard templates. ***')
    }
  })

  hid.on('error', err => console.error('[probe] Error:', err.message))

  // Try a few common capture commands
  const COMMANDS_TO_TRY = [
    [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    [0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
    [0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00],
    [0x41, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],  // 'A'
    [0x43, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],  // 'C' for Capture
  ]

  let cmdIndex = 0
  function trySendNext() {
    if (cmdIndex >= COMMANDS_TO_TRY.length) {
      console.log('[probe] Tried all common commands. Continuing to listen for spontaneous reports...')
      return
    }
    const cmd = COMMANDS_TO_TRY[cmdIndex++]
    const report = Buffer.alloc(65, 0)
    report[0] = 0x00
    cmd.forEach((b, i) => { report[i + 1] = b })
    console.log(`[probe] Trying command: ${cmd.map(b => b.toString(16).padStart(2,'0')).join(' ')}`)
    try {
      hid.write(Array.from(report))
    } catch (e) {
      console.error('[probe] Write failed:', e.message)
    }
    setTimeout(trySendNext, 2000)
  }

  setTimeout(trySendNext, 500)
}

// ── HTTP Bridge Server ───────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // CORS — browser calls localhost:3000 → localhost:11100 (cross-origin)
  // Access-Control-Allow-Private-Network is required by Chrome's Private Network
  // Access policy when a page on localhost accesses a different localhost port.
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  res.setHeader('Access-Control-Allow-Private-Network', 'true')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    res.end()
    return
  }

  const path = req.url?.split('?')[0] ?? '/'
  console.log(`[bridge] ${req.method} ${path}`)

  // ── GET /rd/info  (device ping — browser uses simple GET, no preflight) ────
  if (req.method === 'GET' && path === '/rd/info') {
    const info = findDevice()
    const deviceName = info?.device.product ?? 'CSD200'
    const serial     = info?.device.serialNumber ?? 'UNKNOWN'
    const xml = `<?xml version="1.0" encoding="UTF-8"?><DeviceInfo dpId="PRECISION.CSD200" rdsId="MACOS_BRIDGE" rdsVer="2.0.0" mi="${deviceName}" mc="BRIDGE" dc="BRIDGE"><additional_info><Param name="device_serial" value="${serial}"/></additional_info></DeviceInfo>`
    res.writeHead(200, { 'Content-Type': 'text/xml' })
    res.end(xml)
    return
  }

  // ── POST /rd/capture  (browser posts text/plain PID options, no preflight) ──
  if (req.method === 'POST' && path === '/rd/capture') {
    captureFromDevice()
      .then(base64Template => {
        const xml = `<PidData>\n  <Resp errCode="0" errInfo="Success" fCount="1" fType="0" iCount="0" pCount="0" nmPoints="15" qScore="85" />\n  <Data type="X">${base64Template}</Data>\n  <Hmac>BRIDGE</Hmac>\n</PidData>`
        res.writeHead(200, { 'Content-Type': 'text/xml' })
        res.end(xml)
        console.log('[bridge] ✓ Template captured and returned')
      })
      .catch(err => {
        console.error('[bridge] Capture failed:', err.message)
        const xml = `<PidData>\n  <Resp errCode="999" errInfo="${err.message}" fCount="0" />\n</PidData>`
        res.writeHead(500, { 'Content-Type': 'text/xml' })
        res.end(xml)
      })
    return
  }

  res.writeHead(404)
  res.end('Bridge: unsupported endpoint')
})

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n[bridge] Port ${PORT} is already in use.`)
    console.error('         Stop any existing mock-rd-service or other bridge process first.\n')
  } else {
    console.error('[bridge] Server error:', err.message)
  }
  process.exit(1)
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('─────────────────────────────────────────────────────')
  console.log('  Mahavishnu Wines — CSD200 Fingerprint Bridge')
  console.log(`  Listening on http://127.0.0.1:${PORT}`)
  console.log('─────────────────────────────────────────────────────')

  const info = findDevice()
  if (info) {
    const p = info.profile
    const d = info.device
    console.log(`  Device : ${d.manufacturer ?? '?'} ${d.product ?? '?'}`)
    console.log(`  IDs    : VID:0x${d.vendorId.toString(16)}  PID:0x${d.productId.toString(16)}`)
    if (p) console.log(`  Profile: ${p.name}`)
    console.log('  Status : READY')
  } else {
    console.log('  Device : NOT DETECTED')
    console.log('  ⚠  Plug in the CSD200, or run --list to find the device IDs.')
  }
  console.log('─────────────────────────────────────────────────────\n')
})

process.on('SIGINT', () => {
  console.log('\n[bridge] Shutting down...')
  server.close(() => process.exit(0))
})
