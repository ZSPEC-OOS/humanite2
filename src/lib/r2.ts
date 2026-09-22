import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

let _client: S3Client | null = null

function client(): S3Client {
  if (_client) return _client
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('Missing R2 credentials: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY')
  }
  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
  return _client
}

function bucket(): string {
  const name = process.env.R2_BUCKET_NAME
  if (!name) throw new Error('Missing R2_BUCKET_NAME')
  return name
}

// ── Encryption for the one genuinely sensitive field (apiKey) ───────────────
// The real access-control boundary is the API route's auth (see
// require-auth.ts) — this is defense in depth so a leaked/misconfigured
// bucket alone doesn't hand out a live provider API key in plaintext.

const ALGO = 'aes-256-gcm'

function encryptionKey(): Buffer {
  const secret = process.env.CONFIG_ENCRYPTION_KEY ?? process.env.JWT_SECRET ?? 'dev-secret-replace-in-production'
  return createHash('sha256').update(secret).digest()
}

function encrypt(plaintext: string): string {
  if (!plaintext) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv(ALGO, encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, encrypted]).toString('base64')
}

function decrypt(payload: string): string {
  if (!payload) return ''
  try {
    const buf = Buffer.from(payload, 'base64')
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const encrypted = buf.subarray(28)
    const decipher = createDecipheriv(ALGO, encryptionKey(), iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch {
    return '' // wrong key / corrupted object — fail closed, not fatal
  }
}

export interface StoredApiConfig {
  nickname: string
  modelId: string
  baseUrl: string
  apiKey: string
}

function keyFor(userId: string): string {
  return `api-config/${userId}.json`
}

export async function getApiConfig(userId: string): Promise<StoredApiConfig | null> {
  try {
    const { Body } = await client().send(new GetObjectCommand({ Bucket: bucket(), Key: keyFor(userId) }))
    if (!Body) return null
    const raw = await Body.transformToString()
    const parsed = JSON.parse(raw)
    return {
      nickname: parsed.nickname ?? '',
      modelId: parsed.modelId ?? '',
      baseUrl: parsed.baseUrl ?? '',
      apiKey: decrypt(parsed.apiKeyEncrypted ?? ''),
    }
  } catch (err) {
    if (err instanceof Error && (err.name === 'NoSuchKey' || err.name === 'NotFound')) return null
    throw err
  }
}

export async function putApiConfig(userId: string, config: StoredApiConfig): Promise<void> {
  const body = JSON.stringify({
    nickname: config.nickname,
    modelId: config.modelId,
    baseUrl: config.baseUrl,
    apiKeyEncrypted: encrypt(config.apiKey),
  })
  await client().send(new PutObjectCommand({
    Bucket: bucket(),
    Key: keyFor(userId),
    Body: body,
    ContentType: 'application/json',
  }))
}
