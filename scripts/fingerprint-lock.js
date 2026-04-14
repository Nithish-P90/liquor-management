'use strict'
/**
 * Fingerprint Lock — personal fingerprint recognizer
 *
 * 1. In one terminal:  npm run fingerprint-bridge
 * 2. In another:       npm run fingerprint-lock
 * 3. Open:             http://localhost:3333
 *
 * Templates are saved to scripts/fp-templates.json
 * No external dependencies — uses built-in http + fs only.
 */

const http = require('http')
const fs   = require('fs')
const path = require('path')

const PORT        = 3333
// Allow overriding the bridge port via environment (FP_BRIDGE_PORT or PORT)
const BRIDGE_PORT = Number(process.env.FP_BRIDGE_PORT || process.env.PORT || process.env.BRIDGE_PORT || 11100)
const STORE_FILE  = path.join(__dirname, 'fp-templates.json')

// ── Template storage ──────────────────────────────────────────────────────────
function loadTemplates() {
  try { return JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')) }
  catch { return [] }
}
function saveTemplates(arr) {
  fs.writeFileSync(STORE_FILE, JSON.stringify(arr, null, 2))
}

// ── Bridge calls ──────────────────────────────────────────────────────────────
function bridgeCapture() {
  return new Promise((resolve, reject) => {
    // Simulation mode: generate a fake template locally (no bridge needed)
    if (process.env.FP_SIMULATE_CAPTURE === '1' || process.env.FP_SIMULATE_CAPTURE === 'true') {
      try {
        const fake = generateFakeTemplate()
        const xml = `<PidData>\n  <Resp errCode="0" errInfo="Success" fCount="1" fType="0" iCount="0" pCount="0" nmPoints="15" qScore="85" />\n  <Data type="X">${fake}</Data>\n  <Hmac>BRIDGE</Hmac>\n</PidData>`
        return resolve(xml)
      } catch (e) {
        return reject(e)
      }
    }

    const body = `<?xml version="1.0"?><PidOptions ver="1.0"><Opts fCount="1" fType="0" iCount="0" pCount="0" format="0" pidVer="2.0" timeout="10000" otp="" wadh="" posh=""/></PidOptions>`
    const req = http.request(
      { hostname: '127.0.0.1', port: BRIDGE_PORT, path: '/rd/capture',
        method: 'POST', headers: { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)) }
    )
    req.on('error', reject)
    req.setTimeout(15000, () => reject(new Error('Bridge timeout — is it running?')))
    req.write(body)
    req.end()
  })
}

// ── Fake template generator for simulation/testing ──────────────────────────
function generateFakeTemplate(count = 5) {
  // Create minimal ISO-like buffer with "FMR\0" header and 'count' minutiae
  const header = Buffer.alloc(32, 0)
  header[0] = 0x46; header[1] = 0x4D; header[2] = 0x52; header[3] = 0x00
  header[18] = 1
  header[31] = count

  const minutiae = Buffer.alloc(count * 6)
  for (let i = 0; i < count; i++) {
    const x = Math.floor(Math.random() * 500) + 20
    const y = Math.floor(Math.random() * 500) + 20
    const angle = Math.floor(Math.random() * 180)
    const off = i * 6
    minutiae[off + 0] = (x >> 8) & 0x3F
    minutiae[off + 1] = x & 0xFF
    minutiae[off + 2] = (y >> 8) & 0x3F
    minutiae[off + 3] = y & 0xFF
    minutiae[off + 4] = angle & 0xFF
    minutiae[off + 5] = 0
  }

  const buf = Buffer.concat([header, minutiae])
  return buf.toString('base64')
}

// ── Template extraction from bridge XML ────────────────────────────────────────
function extractTemplate(xml) {
  const m = xml.match(/<Data[^>]*>([A-Za-z0-9+/=\s]+)<\/Data>/)
  return m ? m[1].replace(/\s+/g, '') : null
}

// ── ISO 19794-2 minutiae parser ────────────────────────────────────────────────
function parseMinutiae(b64) {
  try {
    const buf = Buffer.from(b64, 'base64')
    if (buf.length < 32 || buf[0] !== 0x46 || buf[1] !== 0x4D || buf[2] !== 0x52) return []
    if (!buf[18]) return []
    let off = 32          // skip 28-byte header + 4-byte view header
    const count = buf[31] // byte 31 = number of minutiae in first view
    const pts = []
    for (let i = 0; i < count; i++) {
      if (off + 6 > buf.length) break
      pts.push({
        x:     ((buf[off]     & 0x3F) << 8) | buf[off + 1],
        y:     ((buf[off + 2] & 0x3F) << 8) | buf[off + 3],
        angle:  buf[off + 4],
      })
      off += 6
    }
    return pts
  } catch { return [] }
}

// ── Minutiae matching (Dice coefficient) ───────────────────────────────────────
function similarity(m1, m2) {
  if (!m1.length || !m2.length) return 0
  let matched = 0
  const used  = new Set()
  for (const a of m1) {
    for (let j = 0; j < m2.length; j++) {
      if (used.has(j)) continue
      const b  = m2[j]
      const da = Math.abs(a.angle - b.angle)
      if (Math.hypot(a.x - b.x, a.y - b.y) <= 20 && Math.min(da, 180 - da) <= 25) {
        matched++; used.add(j); break
      }
    }
  }
  return (2 * matched) / (m1.length + m2.length)
}

function isMatch(probe, stored, threshold = 0.40) {
  const pm = parseMinutiae(probe)
  if (pm.length < 5) return false
  for (const t of stored) {
    if (similarity(pm, parseMinutiae(t)) >= threshold) return true
  }
  return false
}

// ── UI ─────────────────────────────────────────────────────────────────────────
const HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fingerprint Lock</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:system-ui,sans-serif;background:#0c0c0c;color:#fff;
       display:flex;flex-direction:column;align-items:center;justify-content:center;
       min-height:100vh;gap:36px;user-select:none}
  h1{font-size:1rem;font-weight:700;letter-spacing:.25em;color:#444;text-transform:uppercase}
  #banner{
    font-size:2rem;font-weight:800;letter-spacing:.08em;
    padding:20px 56px;border-radius:14px;text-align:center;
    min-width:320px;transition:background .25s,color .25s
  }
  .idle{background:#161616;color:#333}
  .wait{background:#0e1828;color:#4a7fff;animation:pulse 1.2s infinite}
  .ok  {background:#0a1f0f;color:#3ddc68}
  .fail{background:#1f0a0a;color:#ff4040}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.6}}
  .btns{display:flex;gap:28px}
  .btn{
    display:flex;flex-direction:column;align-items:center;gap:10px;
    width:148px;height:148px;border-radius:50%;
    border:2.5px solid #222;background:#111;
    cursor:pointer;font-size:.72rem;font-weight:700;
    letter-spacing:.12em;color:#555;text-transform:uppercase;
    transition:border-color .2s,color .2s,background .2s
  }
  .btn:hover:not(:disabled){border-color:#555;color:#bbb;background:#181818}
  .btn:active:not(:disabled){transform:scale(.97)}
  .btn:disabled{opacity:.35;cursor:not-allowed}
  svg{width:52px;height:52px;flex-shrink:0}
  #info{font-size:.75rem;color:#333;letter-spacing:.05em}
  #clear{font-size:.7rem;color:#2a2a2a;background:none;border:none;cursor:pointer;
         letter-spacing:.05em;text-transform:uppercase;margin-top:-20px;
         transition:color .2s}
  #clear:hover{color:#666}
</style>
</head>
<body>

<h1>Fingerprint Lock</h1>

<div id="banner" class="idle">READY</div>

<div class="btns">
  <button class="btn" id="regBtn" onclick="act('register')">
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.3">
      <path stroke-linecap="round" stroke-linejoin="round"
        d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04
           l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.092
           2.027-.273 3m-2.755 4.87l.055-.088a13.938 13.938 0
           001.486-4.781M9 12a3 3 0 116 0c0 .607-.086 1.196-.246 1.754"/>
    </svg>
    Register
  </button>
  <button class="btn" id="verBtn" onclick="act('verify')">
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.3">
      <path stroke-linecap="round" stroke-linejoin="round"
        d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0
           0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02
           12.02 0 003 9c0 5.591 3.824 10.29 9 11.622
           5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
    </svg>
    Verify
  </button>
</div>

<div id="info">0 templates enrolled</div>
<button id="clear" onclick="clearAll()">clear all templates</button>

<script>
const banner = document.getElementById('banner')
const info   = document.getElementById('info')

function show(text, cls) {
  banner.textContent = text
  banner.className   = cls
}

function setBusy(b) {
  document.getElementById('regBtn').disabled = b
  document.getElementById('verBtn').disabled = b
}

async function refreshCount() {
  const { count } = await fetch('/api/count').then(r => r.json())
  info.textContent = count + ' template' + (count !== 1 ? 's' : '') + ' enrolled'
}

async function act(type) {
  setBusy(true)
  show('Place finger on scanner…', 'wait')
  try {
    const r = await fetch('/api/' + type, { method: 'POST' })
    const d = await r.json()
    if (type === 'register') {
      if (d.ok) { show('Registered  (' + d.count + '/3 samples)', 'ok'); refreshCount() }
      else       show(d.error || 'Failed', 'fail')
      setTimeout(() => { show('READY', 'idle'); setBusy(false) }, 2500)
    } else {
      show(d.matched ? '✓  WELCOME' : '✗  REJECTED', d.matched ? 'ok' : 'fail')
      setTimeout(() => { show('READY', 'idle'); setBusy(false) }, 3000)
    }
  } catch(e) {
    show('Bridge not running', 'fail')
    setTimeout(() => { show('READY', 'idle'); setBusy(false) }, 2500)
  }
}

async function clearAll() {
  if (!confirm('Delete all enrolled templates?')) return
  await fetch('/api/clear', { method: 'POST' })
  refreshCount()
  show('Cleared', 'idle')
}

refreshCount()
</script>
</body>
</html>`

// ── HTTP server ───────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = req.url?.split('?')[0] ?? '/'

  const json = (data, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }

  if (req.method === 'GET' && url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(HTML)
    return
  }

  if (req.method === 'GET' && url === '/api/count') {
    json({ count: loadTemplates().length })
    return
  }

  if (req.method === 'POST' && url === '/api/register') {
    try {
      const xml      = await bridgeCapture()
      const template = extractTemplate(xml)
      if (!template) { json({ ok: false, error: 'No template in scanner response. Try again.' }); return }
      const list = loadTemplates()
      list.push(template)
      const kept = list.slice(-3)   // keep max 3 samples
      saveTemplates(kept)
      console.log(`[lock] Registered sample ${kept.length}/3`)
      json({ ok: true, count: kept.length })
    } catch (e) {
      console.error('[lock] Register error:', e.message)
      json({ ok: false, error: e.message })
    }
    return
  }

  if (req.method === 'POST' && url === '/api/verify') {
    try {
      const xml      = await bridgeCapture()
      const template = extractTemplate(xml)
      if (!template) { json({ matched: false, error: 'No template in scanner response.' }); return }
      const templates = loadTemplates()
      if (!templates.length) { json({ matched: false, error: 'No templates enrolled yet.' }); return }
      const matched = isMatch(template, templates)
      console.log(`[lock] Verify → ${matched ? 'MATCH' : 'REJECTED'}`)
      json({ matched })
    } catch (e) {
      console.error('[lock] Verify error:', e.message)
      json({ matched: false, error: e.message })
    }
    return
  }

  if (req.method === 'POST' && url === '/api/clear') {
    saveTemplates([])
    console.log('[lock] Templates cleared')
    json({ ok: true })
    return
  }

  res.writeHead(404); res.end()
})

server.listen(PORT, '127.0.0.1', () => {
  console.log('─────────────────────────────────────────')
  console.log('  Fingerprint Lock')
  console.log(`  Open: http://localhost:${PORT}`)
  console.log('─────────────────────────────────────────')
  console.log('  Requires bridge running in another terminal:')
  console.log('  npm run fingerprint-bridge')
  console.log('─────────────────────────────────────────')
})
