import { NextRequest, NextResponse } from 'next/server'
import { Document, Paragraph, TextRun, HeadingLevel, Packer } from 'docx'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  let body: {
    text?: string
    format?: string
    watermark?: Record<string, string>
    job_id?: string
    title?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json(
      { error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } },
      { status: 400 },
    )
  }

  const text = body.text ?? ''
  const format = body.format ?? 'text'
  const title = body.title ?? 'Humanite Export'
  const watermark = body.watermark ?? {}

  if (!text) {
    return NextResponse.json(
      { error: { code: 'VALIDATION_ERROR', message: 'text is required.' } },
      { status: 400 },
    )
  }

  const watermarkLine = watermark.fingerprint
    ? `\n\n---\nVerified by Humanite · ${watermark.fingerprint} · ${watermark.issued_at ?? ''}`
    : ''

  if (format === 'text') {
    return new NextResponse(text + watermarkLine, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Disposition': `attachment; filename="${sanitizeFilename(title)}.txt"`,
      },
    })
  }

  if (format === 'markdown') {
    const md = `# ${title}\n\n${text}${watermarkLine}`
    return new NextResponse(md, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        'Content-Disposition': `attachment; filename="${sanitizeFilename(title)}.md"`,
      },
    })
  }

  if (format === 'docx') {
    const paragraphs = text.split(/\n\n+/).map(
      para =>
        new Paragraph({
          children: [new TextRun({ text: para.trim(), size: 24 })],
          spacing: { after: 200 },
        }),
    )

    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({
              text: title,
              heading: HeadingLevel.HEADING_1,
              spacing: { after: 300 },
            }),
            ...paragraphs,
            ...(watermark.fingerprint
              ? [
                  new Paragraph({
                    children: [
                      new TextRun({
                        text: `Verified by Humanite · ${watermark.fingerprint}`,
                        size: 18,
                        color: '888888',
                      }),
                    ],
                    spacing: { before: 400 },
                  }),
                ]
              : []),
          ],
        },
      ],
    })

    const buffer = await Packer.toBuffer(doc)
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${sanitizeFilename(title)}.docx"`,
      },
    })
  }

  return NextResponse.json(
    { error: { code: 'INVALID_FORMAT', message: 'format must be text, markdown, or docx.' } },
    { status: 400 },
  )
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, '_').slice(0, 80)
}
