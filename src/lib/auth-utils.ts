import { SignJWT, jwtVerify } from 'jose'
import { randomBytes, createHash } from 'crypto'
import bcrypt from 'bcryptjs'
import { isGoldTier } from './accountTier'

const ACCESS_EXPIRE_MINUTES = 15

function jwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET environment variable is not set')
  return new TextEncoder().encode(secret)
}

function scopesForTier(tier: string): string[] {
  const base = ['humanize:write', 'scan:write']
  // 'enterprise' is now just the top-priced self-serve consumer tier ($15/mo
  // — see pricing.ts), not an org/admin account, so it earns no scope beyond
  // what 'pro' already gets. admin:read was previously auto-granted here,
  // which would have handed admin visibility to anyone who simply pays for
  // the highest tier — removed rather than carried forward into this pricing
  // model.
  if (tier === 'pro' || tier === 'enterprise' || isGoldTier(tier)) base.push('user:read')
  return base
}

export async function issueAccessToken(
  userId: string,
  email: string,
  tier: string,
  region: string,
): Promise<string> {
  return new SignJWT({
    email_hash: createHash('sha256').update(email).digest('hex'),
    tier,
    scopes: scopesForTier(tier),
    region,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_EXPIRE_MINUTES}m`)
    .setJti(crypto.randomUUID())
    .sign(jwtSecret())
}

export async function verifyAccessToken(token: string): Promise<Record<string, unknown>> {
  const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ['HS256'] })
  return payload as Record<string, unknown>
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12)
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

export function generateRefreshToken(): { raw: string; hash: string } {
  const raw = randomBytes(32).toString('base64url')
  const hash = createHash('sha256').update(raw).digest('hex')
  return { raw, hash }
}

export function hashRefreshToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}
