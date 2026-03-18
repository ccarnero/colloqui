// Seed script — creates default user + sandbox account.
// Idempotent: skips if user/account already exist.
//
// Usage: bun src/scripts/seed.js
//   (or: node src/scripts/seed.js)

import { config } from 'dotenv'
import { resolve } from 'path'
import { MongoClient, ObjectId } from 'mongodb'
import { hashPassword } from '../auth/hash-password.js'

// ── Config ──────────────────────────────────────────────

const SEED_USER = {
  email: 'christian.carnero@gmail.com',
  password: '*****',
  name: 'Chris',
}

// ── Main ────────────────────────────────────────────────

const seed = async () => {
  // Load .env from project root
  const envPath = resolve(import.meta.dirname || '.', '../../../.env')
  config({ path: envPath })

  const uri = process.env.MONGODB_URI
  if (!uri) {
    console.error('  MONGODB_URI not set. Copy .env.example to .env first.')
    process.exit(1)
  }

  const client = new MongoClient(uri)
  await client.connect()
  const db = client.db()

  console.log(`\n  Seeding database: ${db.databaseName}\n`)

  // ── 1. Create indexes ───────────────────────────────

  await Promise.all([
    db.collection('users').createIndex({ email: 1 }, { unique: true }),
    db.collection('accounts').createIndex({ owner_user_id: 1 }),
    db.collection('accounts').createIndex({ waba_id: 1 }),
    db.collection('contacts').createIndex({ account_id: 1, wa_id: 1 }, { unique: true }),
    db.collection('contacts').createIndex({ account_id: 1, bsuid: 1 }, { sparse: true }),
    db.collection('contacts').createIndex({ account_id: 1, phone: 1 }, { sparse: true }),
    db.collection('messages').createIndex({ account_id: 1, contact_id: 1, created_at: -1 }),
    db.collection('messages').createIndex({ wa_message_id: 1 }, { sparse: true }),
  ])

  console.log('  ✓ Indexes created')

  // ── 2. Create user (skip if exists) ─────────────────

  const existingUser = await db.collection('users').findOne({ email: SEED_USER.email })

  let userId

  if (existingUser) {
    userId = existingUser._id
    console.log(`  ✓ User already exists: ${SEED_USER.email}`)
  } else {
    const passwordHash = await hashPassword(SEED_USER.password)

    const userDoc = {
      _id: new ObjectId(),
      email: SEED_USER.email,
      password_hash: passwordHash,
      name: SEED_USER.name,
      role: 'admin',
      account_ids: [],
      created_at: new Date(),
    }

    await db.collection('users').insertOne(userDoc)
    userId = userDoc._id
    console.log(`  ✓ User created: ${SEED_USER.email}`)
  }

  // ── 3. Create sandbox account (skip if exists) ──────

  const metaPhoneId = process.env.META_PHONE_NUMBER_ID || ''
  const metaToken = process.env.META_ACCESS_TOKEN || ''
  const metaWabaId = process.env.META_WABA_ID || 'sandbox_waba'

  const existingAccount = await db.collection('accounts').findOne({
    owner_user_id: userId,
    waba_id: metaWabaId,
  })

  if (existingAccount) {
    console.log(`  ✓ Sandbox account already exists: ${metaWabaId}`)
  } else {
    const accountDoc = {
      _id: new ObjectId(),
      waba_id: metaWabaId,
      phone_number_id: metaPhoneId,
      display_phone: metaPhoneId || null,
      access_token: metaToken,
      token_expires_at: null,
      business_name: 'WA Connect (Sandbox)',
      status: 'active',
      owner_user_id: userId,
      created_at: new Date(),
      updated_at: new Date(),
    }

    await db.collection('accounts').insertOne(accountDoc)

    // Link account to user
    await db.collection('users').updateOne(
      { _id: userId },
      { $addToSet: { account_ids: accountDoc._id } }
    )

    console.log(`  ✓ Sandbox account created: ${metaWabaId}`)
  }

  // ── Done ────────────────────────────────────────────

  console.log(`
  Seed complete. Login credentials:

    email:    ${SEED_USER.email}
    password: ${SEED_USER.password}

  Change the password after first login.
  `)

  await client.close()
}

seed().catch((e) => {
  console.error('  Seed failed:', e.message)
  process.exit(1)
})
