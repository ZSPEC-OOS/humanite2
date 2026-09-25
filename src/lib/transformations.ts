import { db, tryPersist } from '@/lib/firestore'
import type { buildOutput } from '@/lib/humanizeOutput'

type HumanizeOutput = ReturnType<typeof buildOutput>

// Best-effort, same as the jobs collection (tryPersist) — a caller's
// transformation history is a convenience, never something that should fail
// the humanize response itself if Firestore is briefly unavailable.
export async function saveTransformation(params: {
  jobId: string
  userId: string
  inputText: string
  output: HumanizeOutput
  modelUsed: string
}): Promise<void> {
  await tryPersist(() => db().collection('transformations').doc(params.jobId).set({
    userId: params.userId,
    createdAt: new Date(),
    inputText: params.inputText,
    output: params.output,
    modelUsed: params.modelUsed,
  }), 'save transformation history')
}
