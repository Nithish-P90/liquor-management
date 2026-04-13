import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, unlink } from 'fs/promises'
import os from 'os'
import { parseIndentFromText } from '@/lib/pdf-parser'

export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)

export async function POST(req: NextRequest) {
  try {
    const { pdfPath } = await req.json()
    if (!pdfPath) return NextResponse.json({ error: 'Missing pdfPath' }, { status: 400 })

    const uploadsDir = path.join(process.cwd(), 'uploads', 'indents')
    const safePath = path.join(process.cwd(), pdfPath.replace(/^\/+/, ''))
    if (!safePath.startsWith(uploadsDir)) return NextResponse.json({ error: 'Invalid path' }, { status: 403 })

    // Use pdftoppm (poppler) to rasterize first page to PNG
    const tmpPrefix = path.join(os.tmpdir(), `ocr-${Date.now()}`)
    const pngPath = `${tmpPrefix}.png`
    try {
      await execFileAsync('pdftoppm', ['-r', '300', '-png', '-singlefile', safePath, tmpPrefix])
    } catch (err) {
      return NextResponse.json({ error: 'pdftoppm not available or conversion failed. Install poppler: `brew install poppler`' }, { status: 500 })
    }

    let Tesseract
    try {
      // dynamic import so deployment doesn't fail if package missing
      // eslint-disable-next-line no-eval
      Tesseract = eval('require')('tesseract.js')
    } catch (e) {
      return NextResponse.json({ error: 'tesseract.js not installed. Run `npm install tesseract.js`' }, { status: 500 })
    }

    try {
      const img = await readFile(pngPath)
      const { data } = await Tesseract.recognize(img, 'eng')
      const text = data?.text ?? ''
      // parse using existing parser-from-text
      const parsed = parseIndentFromText(text)
      // attach OCR text and return
      // cleanup
      try { await unlink(pngPath) } catch {}
      return NextResponse.json({ parsed, ocrText: text })
    } catch (err) {
      try { await unlink(pngPath) } catch {}
      return NextResponse.json({ error: 'OCR failed', detail: err instanceof Error ? err.message : String(err) }, { status: 500 })
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Re-OCR failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
