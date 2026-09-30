import { NextRequest, NextResponse } from 'next/server'
import { requireA2HAdmin } from '@/lib/require-a2h-admin'
import { isAuthFailure } from '@/lib/require-auth'
import { db } from '@/lib/firestore'
import { listCorpusProjects, createCorpusProject } from '@/lib/a2h/corpusProject'

export async function GET(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  const projects = await listCorpusProjects(db())
  return NextResponse.json({ projects })
}

interface CreateProjectBody {
  name?: string
  benchmarkVersion?: string
  corpusVersion?: string
}

export async function POST(req: NextRequest) {
  const auth = await requireA2HAdmin(req)
  if (isAuthFailure(auth)) return auth

  let body: CreateProjectBody
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } }, { status: 400 })
  }

  try {
    const project = await createCorpusProject(db(), {
      name: body.name ?? '',
      ...(body.benchmarkVersion !== undefined ? { benchmarkVersion: body.benchmarkVersion } : {}),
      ...(body.corpusVersion !== undefined ? { corpusVersion: body.corpusVersion } : {}),
    })
    return NextResponse.json({ project }, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create corpus project.'
    return NextResponse.json({ error: { code: 'VALIDATION_ERROR', message } }, { status: 400 })
  }
}
