// Idempotent cleanup: removes redundant meta_app_id/meta_app_secret from accounts
// where the stored value matches the .env default (no need to duplicate).
// Accounts with a DIFFERENT meta_app_id are left untouched.
//
// Usage: node server/src/scripts/backfill-meta-credentials.js
// Safe to run multiple times.

import { readEnv } from '../config/env.js'
import { connectDb } from '../db/connect.js'

const run = async () => {
  const env = readEnv()

  if (!env.META_APP_ID) {
    console.log('[CLEANUP] META_APP_ID not set in .env — nothing to clean')
    process.exit(0)
  }

  const { db, client } = await connectDb(env.MONGODB_URI)

  // Remove meta_app_id/secret from accounts where it matches env (redundant — they'll use the fallback)
  const result = await db.collection('accounts').updateMany(
    { meta_app_id: env.META_APP_ID },
    {
      $set: {
        meta_app_id: null,
        meta_app_secret: null,
        updated_at: new Date(),
      },
    }
  )

  console.log(`[CLEANUP] Cleared meta credentials from ${result.modifiedCount} accounts (matched env app ${env.META_APP_ID})`)

  // Report accounts with a different app (these keep their credentials)
  const otherApps = await db.collection('accounts')
    .find({ meta_app_id: { $ne: null } })
    .project({ business_name: 1, meta_app_id: 1 })
    .toArray()

  if (otherApps.length > 0) {
    console.log(`[CLEANUP] ${otherApps.length} accounts have a different Meta App ID (untouched):`)
    otherApps.forEach((a) => console.log(`  - ${a.business_name || a._id}: app ${a.meta_app_id}`))
  } else {
    console.log('[CLEANUP] All accounts now use the .env default')
  }

  await client.close()
  process.exit(0)
}

run().catch((e) => {
  console.error('[CLEANUP] Fatal error:', e.message)
  process.exit(1)
})
