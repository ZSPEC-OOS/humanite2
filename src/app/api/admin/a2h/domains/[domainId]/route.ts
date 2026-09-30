import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { DOMAINS, type Domain } from '@/lib/style/types'
import { getDomainConfig, saveDomainTopicCount, lockDomainTopicCount, unlockDomainTopicCount } from '@/lib/a2h/domainConfig'
import { listTopics } from '@/lib/a2h/topics'

function parseDomainId(value: string): Domain | null {
  return (DOMAINS as readonly string[]).includes(value) ? (value as Domain) : null
}

export async function GET(req: NextRequest, { params }: { params: { domainId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const domainId = parseDomainId(params.domainId)
  if (!domainId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: `domainId must be one of: ${DOMAINS.join(', ')}` } }, { status: 400 })
  }

  const config = await getDomainConfig(db(), domainId)
  return NextResponse.json({ config })
}

interface PatchBody {
  action?: 'save' | 'lock' | 'unlock'
  topicCount?: number
}

export async function PATCH(req: NextRequest, { params }: { params: { domainId: string } }) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const domainId = parseDomainId(params.domainId)
  if (!domainId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: `domainId must be one of: ${DOMAINS.join(', ')}` } }, { status: 400 })
  }

  let body: PatchBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  try {
    if (body.action === 'save') {
      if (typeof body.topicCount !== 'number') {
        return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'topicCount is required to save.' } }, { status: 400 })
      }
      const config = await saveDomainTopicCount(db(), domainId, body.topicCount)
      return NextResponse.json({ config })
    }
    if (body.action === 'lock') {
      const config = await lockDomainTopicCount(db(), domainId, body.topicCount)
      return NextResponse.json({ config })
    }
    if (body.action === 'unlock') {
      const existingTopics = await listTopics(db(), domainId)
      const config = await unlockDomainTopicCount(db(), domainId, existingTopics.length)
      return NextResponse.json({ config })
    }
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'action must be one of: save, lock, unlock' } }, { status: 400 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed.'
    return NextResponse.json({ error: { code: 'CONFLICT', message } }, { status: 409 })
  }
}
