import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'

export async function GET(req: NextRequest, { params }: { params: { filename?: string } }) {
  const filename = params?.filename
  if (!filename) return NextResponse.json({ error: 'Missing filename' }, { status: 400 })

  const uploadsDir = path.join(process.cwd(), 'uploads', 'indents')
  const safePath = path.join(uploadsDir, filename)

  // Prevent path traversal
  if (!safePath.startsWith(uploadsDir)) {
    return NextResponse.json({ error: 'Invalid file path' }, { status: 403 })
  }

  try {
    const buffer = await readFile(safePath)
    return new NextResponse(buffer, {
      headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-cache' },
    })
  } catch {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }
}
