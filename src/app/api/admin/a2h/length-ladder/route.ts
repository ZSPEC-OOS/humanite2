import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { getLengthLadderConfig, saveLengthLadder, lockLengthLadder, expandLengthLadder } from '@/lib/a2h/lengthLadder'

export async function GET(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const config = await getLengthLadderConfig(db())
  return NextResponse.json({ config })
}

interface PatchBody {
  action?: 'save' | 'lock' | 'expand'
  ladder?: unknown
}

export async function PATCH(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: PatchBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  try {
    if (body.action === 'save') {
      const config = await saveLengthLadder(db(), body.ladder)
      return NextResponse.json({ config })
    }
    if (body.action === 'lock') {
      const config = await lockLengthLadder(db(), body.ladder)
      return NextResponse.json({ config })
    }
    if (body.action === 'expand') {
      const config = await expandLengthLadder(db(), body.ladder)
      return NextResponse.json({ config })
    }
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'action must be one of: save, lock, expand' } }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed.'
    return NextResponse.json({ error: { code: 'CONFLICT', message } }, { status: 409 })
  }
}
