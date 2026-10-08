/** TEMPORARY: see src/lib/temp-purge/purge.ts. Remove with the homepage button. */
import { NextResponse } from 'next/server'
import { db } from '@/lib/firestore'
import { PURGE_COLLECTIONS, decidePurge } from '@/lib/temp-purge/purge'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(req: Request) {
  let body: Record<string, unknown> = {}
  try { body = (await req.json()) as Record<string, unknown> } catch { /* handled below as a bad action */ }
  const decision = decidePurge({ action: body['action'], collection: body['collection'] })
  if (!decision.ok) return NextResponse.json({ error: decision.message }, { status: decision.status })
  try {
    const firestore = db()
    if (decision.action === 'count') {
      const counts: Record<string, number> = {}
      for (const name of PURGE_COLLECTIONS) counts[name] = (await firestore.collection(name).count().get()).data().count
      return NextResponse.json({ counts })
    }
    const name = decision.collection!
    await firestore.recursiveDelete(firestore.collection(name))
    const remaining = (await firestore.collection(name).count().get()).data().count
    return NextResponse.json({ collection: name, remaining })
  } catch {
    return NextResponse.json({ error: 'Firestore request failed (check the server logs).' }, { status: 500 })
  }
}
