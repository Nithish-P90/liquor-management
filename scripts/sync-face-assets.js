const fs = require('fs')
const path = require('path')

const isElectronPackage = path.basename(process.cwd()) === 'electron-app'
const repoRoot = isElectronPackage ? path.resolve(process.cwd(), '..') : process.cwd()
const sourcePublicDir = path.join(repoRoot, 'public')
const electronPublicDir = path.join(repoRoot, 'electron-app', 'public')

function copyFileIfExists(sourcePath, destinationPath) {
  if (!fs.existsSync(sourcePath)) return false
  fs.mkdirSync(path.dirname(destinationPath), { recursive: true })
  fs.copyFileSync(sourcePath, destinationPath)
  return true
}

function copyDirectory(sourceDir, destinationDir) {
  if (!fs.existsSync(sourceDir)) return 0

  let copied = 0
  const entries = fs.readdirSync(sourceDir, { withFileTypes: true })
  fs.mkdirSync(destinationDir, { recursive: true })

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const destinationPath = path.join(destinationDir, entry.name)

    if (entry.isDirectory()) {
      copied += copyDirectory(sourcePath, destinationPath)
      continue
    }

    fs.copyFileSync(sourcePath, destinationPath)
    copied += 1
  }

  return copied
}

function main() {
  const faceModelSourceDir = path.join(sourcePublicDir, 'face-models')
  const faceModelTargetDir = path.join(electronPublicDir, 'face-models')
  const vendorSourceDir = path.join(sourcePublicDir, 'vendor', 'face-api')
  const vendorTargetDir = path.join(electronPublicDir, 'vendor', 'face-api')

  if (!fs.existsSync(faceModelSourceDir) && !fs.existsSync(vendorSourceDir)) {
    console.log('[sync-face-assets] No face assets found in public/. Skipping copy.')
    return
  }

  let copiedFiles = 0
  copiedFiles += copyDirectory(faceModelSourceDir, faceModelTargetDir)
  copiedFiles += copyDirectory(vendorSourceDir, vendorTargetDir)

  // Keep the Electron app in sync even if only one package was installed.
  if (copyFileIfExists(path.join(sourcePublicDir, 'face-models', 'README.txt'), path.join(faceModelTargetDir, 'README.txt'))) {
    copiedFiles += 1
  }

  console.log(`[sync-face-assets] Copied ${copiedFiles} file(s) into electron-app/public`)
}

main()
