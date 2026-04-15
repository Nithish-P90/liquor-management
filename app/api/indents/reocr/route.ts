import { NextRequest, NextResponse } from 'next/server'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, unlink } from 'fs/promises'
import os from 'os'
import { parseIndentFromText, parseIndentPdf } from '@/lib/pdf-parser'

export const dynamic = 'force-dynamic'

const execFileAsync = promisify(execFile)

export async function POST(req: NextRequest) {
  try {
    const { pdfPath } = await req.json()
    if (!pdfPath) return NextResponse.json({ error: 'Missing pdfPath' }, { status: 400 })

    let buffer: Buffer
    let tempPdfPath: string | null = null

    if (pdfPath.startsWith('data:')) {
      // Handle Base64 Data URL
      const base64Data = pdfPath.split(',')[1]
      buffer = Buffer.from(base64Data, 'base64')
      // pdftoppm needs a file on disk. Use /tmp
      tempPdfPath = path.join(os.tmpdir(), `reocr-${Date.now()}.pdf`)
      const { writeFile } = await import('fs/promises')
      await writeFile(tempPdfPath, buffer)
    } else {
      // Handle local file path
      const safePath = path.join(process.cwd(), pdfPath.replace(/^\/+/, ''))
      const uploadsDir = path.join(process.cwd(), 'uploads', 'indents')
      if (!safePath.startsWith(uploadsDir)) return NextResponse.json({ error: 'Invalid path' }, { status: 403 })
      buffer = await readFile(safePath)
      tempPdfPath = safePath
    }

    // Use pdftoppm (poppler) to rasterize first page to PNG
    const tmpPrefix = path.join(os.tmpdir(), `ocr-${Date.now()}`)
    const pngPath = `${tmpPrefix}.png`
    try {
      await execFileAsync('pdftoppm', ['-r', '300', '-png', '-singlefile', tempPdfPath, tmpPrefix])
    } catch (err) {
      // If pdftoppm is not available (common on serverless platforms), try a text-extraction fallback
      if (pdfPath.startsWith('data:') && buffer) {
        try {
          const parsed = await parseIndentPdf(buffer)
          if (pdfPath.startsWith('data:') && tempPdfPath) try { await unlink(tempPdfPath) } catch {}
          return NextResponse.json({ parsed, ocrText: parsed.rawText ?? '', warning: 'pdftoppm not available; used text-extraction fallback' })
        } catch (e) {
          if (pdfPath.startsWith('data:') && tempPdfPath) try { await unlink(tempPdfPath) } catch {}
          return NextResponse.json({ error: 'pdftoppm not available or conversion failed, and text-extraction fallback also failed' }, { status: 500 })
        }
      }

      if (pdfPath.startsWith('data:') && tempPdfPath) try { await unlink(tempPdfPath) } catch {}
      return NextResponse.json({ error: 'pdftoppm not available or conversion failed. Install poppler: `brew install poppler`' }, { status: 500 })
    }

    if (pdfPath.startsWith('data:') && tempPdfPath) try { await unlink(tempPdfPath) } catch {}

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
