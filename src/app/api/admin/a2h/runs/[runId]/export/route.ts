import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { EXPORT_FILE_NAMES, buildExportFile, type ExportFileName } from '@/lib/a2h/exportPackage'

function isExportFileName(value: string): value is ExportFileName {
  return (EXPORT_FILE_NAMES as readonly string[]).includes(value)
}

// No `file` query param: returns the list of available files (the admin
// UI's download-links view). With `file=<name>`: streams that one file's
// raw content with the right Content-Type/Content-Disposition — the raw
// export a researcher can independently reproduce every reported aggregate
// from, not a screenshot of an admin page.
export async function GET(req: NextRequest, { params }: { params: { runId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const fileParam = req.nextUrl.searchParams.get('file')
  if (!fileParam) {
    return NextResponse.json({ files: EXPORT_FILE_NAMES })
  }
  if (!isExportFileName(fileParam)) {
    return NextResponse.json({ error: { code: 'INVALID_FILE', message: `Unknown export file '${fileParam}'.` } }, { status: 400 })
  }

  const file = await buildExportFile(db(), params.runId, fileParam)
  if (!file) {
    return NextResponse.json({ error: { code: 'NOT_FOUND', message: 'Run not found.' } }, { status: 404 })
  }
  return new NextResponse(file.content, {
    headers: {
      'Content-Type': file.contentType === 'text/csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${file.name}"`,
    },
  })
}
