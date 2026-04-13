/**
 * ISO 19794-2:2005 Fingerprint Minutiae Extraction & 1:N Matching
 *
 * Compatible hardware (cheap, off-the-shelf):
 * ─────────────────────────────────────────────────────────────────
 *  • Mantra MFS100   (~₹1,500–2,000 on Amazon/Flipkart)
 *    USB optical sensor. Requires the Mantra RD Service daemon to be
 *    running on the host PC (Linux: port 11100, Windows: port 11100).
 *    Download: https://www.mantratec.com/products/Fingerprint-Sensors/MFS100-USB-Fingerprint-Sensor
 *
 *  • Startek FM220U  (~₹1,200–1,800)
 *    Drop-in Mantra-compatible; same RD Service daemon works.
 *
 *  • ZKTeco ZK9500   (~₹2,000–3,000)
 *    USB, uses the ZKFinger SDK (separate integration needed).
 *
 * All sensors produce ISO 19794-2 templates.  The matching below
 * works with any of them as long as the base64 template is extracted
 * from the sensor response.
 *
 * Mantra RD Service → how it works:
 *   1. Run daemon:  ./mantra-rds   (Linux) or the Windows installer
 *   2. Daemon listens on http://127.0.0.1:11100
 *   3. Send CAPTURE request → returns PID XML with a <Data> element
 *      containing the ISO template encoded in base64.
 *   4. Use extractTemplateFromXml() to pull out the base64 string.
 *   5. Store that string once per staff (enrollment).
 *   6. On clock-in: capture → extract → matchAgainstStored() → done.
 */

export interface Minutia {
  type: number     // 0=OTHER, 1=RIDGE_END, 2=BIFURCATION
  x: number        // horizontal position, 14-bit integer
  y: number        // vertical position, 14-bit integer
  angle: number    // orientation 0–179, each unit = 2 degrees
  quality: number  // 0–100
}

// ── Template extraction ────────────────────────────────────────────────────────

/**
 * Pull the base64 fingerprint template out of a Mantra RD Service XML blob.
 *
 * The XML looks like:
 *   <PidData>
 *     <Resp errCode="0" .../>
 *     <Data type="X">Rk1SACAyMA...base64...</Data>
 *   </PidData>
 */
export function extractTemplateFromXml(xml: string): string | null {
  const match = xml.match(/<Data[^>]*>([A-Za-z0-9+/=\s]+)<\/Data>/)
  if (!match) return null
  return match[1].replace(/\s+/g, '')
}

/**
 * Detect whether a stored template is raw XML (old format) or base64 (new).
 * Returns the base64 form in either case.
 */
export function normaliseStoredTemplate(raw: string): string {
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<Pid')) {
    return extractTemplateFromXml(raw) ?? raw
  }
  // May be a JSON array of templates stored as "[\"...\",\"...\"]"
  if (trimmed.startsWith('[')) {
    try {
      const arr: string[] = JSON.parse(raw)
      return arr[0] ?? raw
    } catch { /* fall through */ }
  }
  return raw
}

/**
 * Same as normaliseStoredTemplate but returns ALL templates
 * (for multi-enrollment storage).
 */
export function normaliseAllTemplates(raw: string): string[] {
  const trimmed = raw.trimStart()
  if (trimmed.startsWith('[')) {
    try {
      const arr: string[] = JSON.parse(raw)
      return arr.map(t => normaliseStoredTemplate(t))
    } catch { /* fall through */ }
  }
  return [normaliseStoredTemplate(raw)]
}

// ── ISO 19794-2:2005 parser ───────────────────────────────────────────────────

/**
 * Parse an ISO 19794-2:2005 base64 template and return the minutiae list.
 *
 * Record layout:
 *   Bytes 0–3   : "FMR\0"
 *   Bytes 4–7   : version "20\0\0"
 *   Bytes 8–11  : total record length
 *   Bytes 12–27 : device info, resolution fields
 *   Byte  18    : number of finger views
 *   Then for each finger view:
 *     Byte 0: finger position
 *     Byte 1: impression type
 *     Byte 2: finger quality
 *     Byte 3: number of minutiae
 *     Then per minutia (6 bytes):
 *       Byte 0–1: type(2b) + X(14b)
 *       Byte 2–3: pad(2b)  + Y(14b)
 *       Byte 4  : angle (0–179, unit=2°)
 *       Byte 5  : quality (0–100)
 */
export function parseMinutiae(base64: string): Minutia[] {
  try {
    const buf = Buffer.from(base64, 'base64')
    if (buf.length < 32) return []

    // Check FMR magic bytes: 0x46 0x4D 0x52 0x00
    if (buf[0] !== 0x46 || buf[1] !== 0x4D || buf[2] !== 0x52) {
      return []
    }

    const numViews = buf[18]
    if (numViews === 0) return []

    // Finger view header starts at byte 28
    let offset = 28
    if (offset + 4 > buf.length) return []

    const numMinutiae = buf[offset + 3]
    offset += 4

    const minutiae: Minutia[] = []

    for (let i = 0; i < numMinutiae; i++) {
      if (offset + 6 > buf.length) break

      const type = (buf[offset] >> 6) & 0x03
      const x    = ((buf[offset]     & 0x3F) << 8) | buf[offset + 1]
      const y    = ((buf[offset + 2] & 0x3F) << 8) | buf[offset + 3]
      const angle   = buf[offset + 4]
      const quality = buf[offset + 5]

      minutiae.push({ type, x, y, angle, quality })
      offset += 6
    }

    return minutiae
  } catch {
    return []
  }
}

// ── Matching ──────────────────────────────────────────────────────────────────

/**
 * Compute a Dice-coefficient similarity score between two minutiae sets.
 *
 * Two minutiae are considered matching if:
 *   • Euclidean distance ≤ spatialTolerance pixels (default 20 px)
 *   • Angular difference ≤ angleTolerance units (default 25 units = 50°)
 *
 * Returns 0.0 (no match) … 1.0 (identical).
 */
export function computeSimilarity(
  m1: Minutia[],
  m2: Minutia[],
  spatialTolerance = 20,
  angleTolerance   = 25,
): number {
  if (m1.length === 0 || m2.length === 0) return 0

  let matched = 0
  const used  = new Set<number>()

  for (const p1 of m1) {
    for (let j = 0; j < m2.length; j++) {
      if (used.has(j)) continue
      const p2 = m2[j]

      const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y)
      const rawDA = Math.abs(p1.angle - p2.angle)
      const da    = Math.min(rawDA, 180 - rawDA)

      if (dist <= spatialTolerance && da <= angleTolerance) {
        matched++
        used.add(j)
        break
      }
    }
  }

  return (2 * matched) / (m1.length + m2.length)
}

/**
 * Fallback byte-similarity for sensors/firmware that don't emit standard
 * ISO 19794-2 headers (e.g. some cheap clones).
 * Samples every 4th byte; accepts if 60%+ bytes are within ±8.
 */
function rawByteSimilarity(b64a: string, b64b: string): number {
  try {
    const a = Buffer.from(b64a, 'base64')
    const b = Buffer.from(b64b, 'base64')
    const minLen = Math.min(a.length, b.length)
    const maxLen = Math.max(a.length, b.length)
    if (maxLen === 0 || minLen < 16) return 0

    let matches = 0, samples = 0
    for (let i = 0; i < minLen; i += 4) {
      if (Math.abs(a[i] - b[i]) < 8) matches++
      samples++
    }
    return samples > 0 ? matches / samples : 0
  } catch {
    return 0
  }
}

// ── 1:N matching entry point ──────────────────────────────────────────────────

export interface MatchResult {
  matched:   boolean
  score:     number   // 0.0–1.0
  bestIndex: number   // index in storedTemplates, -1 if no match
  method:    'minutiae' | 'fallback' | 'none'
}

/**
 * Compare a freshly-captured probe template against every stored template
 * and return the best result.
 *
 * @param probeBase64      Base64 ISO template from the live capture
 * @param storedTemplates  Array of base64 templates stored during enrollment
 * @param threshold        Minimum similarity to accept as a match (default 0.40)
 */
export function matchAgainstStored(
  probeBase64:     string,
  storedTemplates: string[],
  threshold        = 0.40,
): MatchResult {
  if (storedTemplates.length === 0) {
    return { matched: false, score: 0, bestIndex: -1, method: 'none' }
  }

  const probeMinutiae = parseMinutiae(probeBase64)

  // ── ISO minutiae path ──────────────────────────────────────────────────────
  if (probeMinutiae.length >= 10) {
    let bestScore = 0
    let bestIndex = -1

    for (let i = 0; i < storedTemplates.length; i++) {
      const storedMinutiae = parseMinutiae(storedTemplates[i])
      if (storedMinutiae.length < 5) continue

      const score = computeSimilarity(probeMinutiae, storedMinutiae)
      if (score > bestScore) { bestScore = score; bestIndex = i }
    }

    if (bestIndex >= 0) {
      return {
        matched:   bestScore >= threshold,
        score:     bestScore,
        bestIndex,
        method:    'minutiae',
      }
    }
  }

  // ── Raw byte fallback (non-standard template or parse failure) ─────────────
  let bestScore = 0
  let bestIndex = -1

  for (let i = 0; i < storedTemplates.length; i++) {
    const score = rawByteSimilarity(probeBase64, storedTemplates[i])
    if (score > bestScore) { bestScore = score; bestIndex = i }
  }

  return {
    matched:   bestScore >= Math.min(threshold, 0.60),
    score:     bestScore,
    bestIndex,
    method:    'fallback',
  }
}
