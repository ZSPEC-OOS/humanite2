import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/firestore'
import { requireAuth, isAuthFailure } from '@/lib/require-auth'

const LIST_LIMIT = 30
const PREVIEW_CHARS = 120

function preview(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > PREVIEW_CHARS ? `${trimmed.slice(0, PREVIEW_CHARS)}…` : trimmed
}

function wordCount(text: string): number {
  const trimmed = text.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

// List is deliberately lightweight (previews only, not the full text) — the
// sidebar renders many of these at once, and a caller only needs the full
// input/output for the one entry they actually click; see [id]/route.ts.
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (isAuthFailure(auth)) return auth

  const snap = await db().collection('transformations')
    .where('userId', '==', auth.claims.sub)
    .orderBy('createdAt', 'desc')
    .limit(LIST_LIMIT)
    .get()

  return NextResponse.json(snap.docs.map(d => {
    const t = d.data()
    return {
      id: d.id,
      created_at: t.createdAt.toDate().toISOString(),
      input_preview: preview(t.inputText ?? ''),
      output_preview: preview(t.output?.text ?? ''),
      word_count: wordCount(t.output?.text ?? ''),
    }
  }))
}
