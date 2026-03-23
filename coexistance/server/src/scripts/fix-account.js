// Syncs the sandbox account in MongoDB with current .env values.
// Run this after changing META_ACCESS_TOKEN, META_PHONE_NUMBER_ID, or META_WABA_ID.
//
// Usage: bun src/scripts/fix-account.js
//   (or: node src/scripts/fix-account.js)

import { config } from 'dotenv'
import { resolve } from 'path'
import { MongoClient } from 'mongodb'

const envPath = resolve(import.meta.dirname || '.', '../../../.env')
config({ path: envPath })

const fix = async () => {
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID
  const wabaId = process.env.META_WABA_ID
  const accessToken = process.env.META_ACCESS_TOKEN

  if (!phoneNumberId || !wabaId || !accessToken) {
    console.error('  Missing META_PHONE_NUMBER_ID, META_WABA_ID, or META_ACCESS_TOKEN in .env')
    process.exit(1)
  }

  const client = new MongoClient(process.env.MONGODB_URI)
  await client.connect()
  const db = client.db()

  console.log('\n  Syncing account with .env values...\n')

  // Update ALL accounts that could be the sandbox (match by old or new values)
  const result = await db.collection('accounts').updateMany(
    {
      $or: [
        { phone_number_id: phoneNumberId },
        { phone_number_id: '+15551541722' },
        { waba_id: wabaId },
        { waba_id: 'sandbox_waba' },
        { waba_id: '' },
        { business_name: 'Coexistance (Sandbox)' },
      ],
    },
    {
      $set: {
        phone_number_id: phoneNumberId,
        waba_id: wabaId,
        access_token: accessToken,
        display_phone: '+15551541722',
        updated_at: new Date(),
      },
    }
  )

  console.log(`  Updated ${result.modifiedCount} account(s)`)

  // Show current state
  const account = await db.collection('accounts').findOne({ phone_number_id: phoneNumberId })
  if (account) {
    console.log(`\n  Account verified:`)
    console.log(`    _id:              ${account._id}`)
    console.log(`    waba_id:          ${account.waba_id}`)
    console.log(`    phone_number_id:  ${account.phone_number_id}`)
    console.log(`    display_phone:    ${account.display_phone}`)
    console.log(`    access_token:     ${account.access_token.slice(0, 20)}...`)
    console.log(`    business_name:    ${account.business_name}`)
    console.log(`    status:           ${account.status}`)
  } else {
    console.log('  WARNING: No account found after update!')
  }

  const msgCount = await db.collection('messages').countDocuments({ account_id: account?._id })
  console.log(`\n  Messages for this account: ${msgCount}`)

  console.log('\n  Done. Restart the server.\n')
  await client.close()
}

fix().catch((e) => {
  console.error('  Fix failed:', e.message)
  process.exit(1)
})
