import { db } from '@/lib/firestore'
import { hashContent } from '@/lib/watermark'

export interface Verification {
  fingerprint: string
  issuedAt: string
}

// Confirms `text` is genuinely the output of `jobId` before letting it carry
// a "Verified by Humanite" claim — never trusts a client-supplied watermark
// object, which is exactly what let any authenticated caller stamp arbitrary
// text as verified. Requires the job to belong to the caller and its stored
// contentHash to match; anything else exports fine, just without the claim
// (a lookup failure degrades the same way — see catch below — matching this
// app's existing posture of not failing a whole request over Firestore being
// unavailable for something non-essential to the export itself).
export async function resolveVerification(
  jobId: string | undefined,
  userId: string,
  text: string,
): Promise<Verification | null> {
  if (!jobId) return null
  try {
    const snap = await db().collection('jobs').doc(jobId).get()
    if (!snap.exists) return null
    const job = snap.data()!
    if (job.userId !== userId) return null
    if (!job.watermarkFingerprint || !job.contentHash) return null
    if (hashContent(text) !== job.contentHash) return null
    return {
      fingerprint: job.watermarkFingerprint,
      issuedAt: job.completedAt ? job.completedAt.toDate().toISOString() : '',
    }
  } catch (err) {
    console.warn('Export verification lookup unavailable — exporting without a verified line', {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return null
  }
}
