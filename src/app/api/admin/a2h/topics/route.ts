import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { listTopics, createTopic, parseTopicInput } from '@/lib/a2h/topics'
import { DOMAINS, type Domain } from '@/lib/style/types'

export async function GET(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const corpusProjectId = req.nextUrl.searchParams.get('corpusProjectId')
  if (!corpusProjectId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'corpusProjectId is required.' } }, { status: 400 })
  }
  const domainParam = req.nextUrl.searchParams.get('domainId')
  const domainId = domainParam && (DOMAINS as readonly string[]).includes(domainParam) ? (domainParam as Domain) : undefined
  const topics = await listTopics(db(), corpusProjectId, domainId)
  return NextResponse.json({ topics })
}

export async function POST(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  const corpusProjectId = body.corpusProjectId
  if (typeof corpusProjectId !== 'string' || !corpusProjectId) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'corpusProjectId is required.' } }, { status: 400 })
  }

  const parsed = parseTopicInput(body)
  if ('error' in parsed) {
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error } }, { status: 400 })
  }

  const topic = await createTopic(db(), { ...parsed.input, corpusProjectId })
  return NextResponse.json({ topic }, { status: 201 })
}
