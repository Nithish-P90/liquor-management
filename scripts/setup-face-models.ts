import fs from "node:fs"
import path from "node:path"
import https from "node:https"

const destDir = path.join(process.cwd(), "public", "models")

// Models required by the attendance kiosk + enrollment page
// Source: https://github.com/justadudewhohacks/face-api.js/tree/master/weights
const BASE = "https://raw.githubusercontent.com/justadudewhohacks/face-api.js/master/weights"

const FILES = [
  // Tiny face detector (kiosk real-time scan)
  "tiny_face_detector_model-weights_manifest.json",
  "tiny_face_detector_model-shard1",
  // 68-landmark tiny (kiosk liveness / blink detection)
  "face_landmark_68_tiny_model-weights_manifest.json",
  "face_landmark_68_tiny_model-shard1",
  // 68-landmark full (high-accuracy enrollment)
  "face_landmark_68_model-weights_manifest.json",
  "face_landmark_68_model-shard1",
  // SSD Mobilenet V1 (high-accuracy enrollment detector)
  "ssd_mobilenetv1_model-weights_manifest.json",
  "ssd_mobilenetv1_model-shard1",
  "ssd_mobilenetv1_model-shard2",
  // Face recognition net (128-dim descriptor — kiosk + enrollment)
  "face_recognition_model-weights_manifest.json",
  "face_recognition_model-shard1",
  "face_recognition_model-shard2",
]

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const get = (u: string): void => {
      https.get(u, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          file.destroy()
          return get(res.headers.location!)
        }
        if (res.statusCode !== 200) {
          file.destroy()
          if (fs.existsSync(dest)) fs.unlinkSync(dest)
          return reject(new Error(`HTTP ${res.statusCode} for ${u}`))
        }
        res.pipe(file)
        file.on("finish", () => file.close(() => resolve()))
      }).on("error", (err) => {
        file.destroy()
        if (fs.existsSync(dest)) fs.unlinkSync(dest)
        reject(err)
      })
    }
    get(url)
  })
}

async function main(): Promise<void> {
  fs.mkdirSync(destDir, { recursive: true })
  // eslint-disable-next-line no-console
  console.log(`Downloading ${FILES.length} model files to public/models …\n`)

  let downloaded = 0
  let skipped = 0

  for (const file of FILES) {
    const dest = path.join(destDir, file)
    if (fs.existsSync(dest)) {
      // eslint-disable-next-line no-console
      console.log(`  skip  ${file}`)
      skipped++
      continue
    }
    process.stdout.write(`  fetch ${file} … `)
    try {
      await download(`${BASE}/${file}`, dest)
      process.stdout.write("✓\n")
      downloaded++
    } catch (e) {
      process.stdout.write(`FAILED: ${(e as Error).message}\n`)
    }
  }

  // eslint-disable-next-line no-console
  console.log(`\n✓ Done — ${downloaded} downloaded, ${skipped} already present.`)
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e)
  process.exit(1)
})
