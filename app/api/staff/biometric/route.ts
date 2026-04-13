import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { extractTemplateFromXml, normaliseAllTemplates } from '@/lib/fingerprint-matcher'

/**
 * POST /api/staff/biometric
 *
 * Enroll or add a fingerprint template for a staff member.
 *
 * Body:
 *   { staffId: number, template: string }
 *
 *   `template` can be:
 *     - Raw Mantra RD XML string  → the base64 Data element is extracted automatically
 *     - Already-extracted base64  → stored as-is
 *
 * Supports multi-enrollment: up to 3 templates are stored per staff member
 * as a JSON array.  Subsequent enrollments append to the array (oldest dropped
 * when limit is exceeded).  More samples = better matching accuracy.
 */
export async function POST(req: NextRequest) {
  try {
    const { staffId, template } = await req.json()
    if (!staffId || !template) {
      return NextResponse.json({ error: 'Missing staffId or template.' }, { status: 400 })
    }

    // Extract base64 from XML if the raw daemon response was sent
    const raw = (template as string).trimStart()
    const base64Template = raw.startsWith('<')
      ? extractTemplateFromXml(template)
      : template

    if (!base64Template) {
      return NextResponse.json(
        { error: 'Could not extract fingerprint template from the provided data.' },
        { status: 400 }
      )
    }

    // Load existing templates for this staff member
    const staff = await prisma.staff.findUnique({
      where:  { id: staffId },
      select: { fingerprintTemplate: true },
    })

    const existing = staff?.fingerprintTemplate
      ? normaliseAllTemplates(staff.fingerprintTemplate)
      : []

    // Append new template; keep last 3
    const updated = [...existing, base64Template].slice(-3)

    await prisma.staff.update({
      where: { id: staffId },
      data:  { fingerprintTemplate: JSON.stringify(updated) },
    })

    return NextResponse.json({
      success:       true,
      samplesStored: updated.length,
      message:       `Template ${updated.length}/3 enrolled. ${3 - updated.length > 0 ? `Enroll ${3 - updated.length} more scan(s) for best accuracy.` : 'Enrollment complete.'}`,
    })
  } catch (error: any) {
    console.error('[biometric POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

/**
 * DELETE /api/staff/biometric
 *
 * Remove all fingerprint templates for a staff member.
 * Body: { staffId: number }
 */
export async function DELETE(req: NextRequest) {
  try {
    const { staffId } = await req.json()
    if (!staffId) {
      return NextResponse.json({ error: 'Missing staffId.' }, { status: 400 })
    }

    await prisma.staff.update({
      where: { id: staffId },
      data:  { fingerprintTemplate: null },
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
