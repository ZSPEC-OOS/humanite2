import { initializeApp, getApps, cert, type App } from 'firebase-admin/app'
import { getFirestore, type Firestore } from 'firebase-admin/firestore'

let _app: App | null = null
let _db: Firestore | null = null

function getApp(): App {
  if (_app) return _app
  if (getApps().length > 0) {
    _app = getApps()[0]!
    return _app
  }
  const projectId = process.env.FIREBASE_PROJECT_ID
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error('Missing Firebase credentials: FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY')
  }

  _app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) })
  return _app
}

export function db(): Firestore {
  if (!_db) {
    getApp()
    _db = getFirestore()
  }
  return _db
}

// Wraps a Firestore write so a missing/misconfigured backing store degrades
// job tracking instead of crashing the request — humanize/scan results
// don't depend on this succeeding, only async job polling does.
export async function tryPersist(op: () => Promise<unknown>, context: string): Promise<boolean> {
  try {
    await op()
    return true
  } catch (err) {
    console.warn(`Job persistence unavailable (${context}) — continuing without it`, {
      type: err instanceof Error ? err.constructor.name : typeof err,
    })
    return false
  }
}
