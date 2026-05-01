import fs from "node:fs"
import path from "node:path"

const projectRoot = process.cwd()
const sourceDir = path.join(projectRoot, "node_modules", "face-api.js", "weights")
const destDir = path.join(projectRoot, "public", "models")

function ensureDir(p: string): void {
  fs.mkdirSync(p, { recursive: true })
}

function copyFile(src: string, dst: string): void {
  ensureDir(path.dirname(dst))
  fs.copyFileSync(src, dst)
}

function main(): void {
  if (!fs.existsSync(sourceDir)) {
    // eslint-disable-next-line no-console
    console.error(`Missing face-api weights at ${sourceDir}`)
    process.exit(1)
  }

  ensureDir(destDir)
  const files = fs.readdirSync(sourceDir).filter((f) => f.endsWith(".bin") || f.endsWith(".json"))
  for (const f of files) {
    copyFile(path.join(sourceDir, f), path.join(destDir, f))
  }

  // eslint-disable-next-line no-console
  console.log(`Copied ${files.length} model files to ${destDir}`)
}

main()

