// Connects to MongoDB using the native driver.
// Returns the db instance — every db function receives it as first argument.
// No Mongoose, no models, no classes.

import { MongoClient } from 'mongodb'

const connectDb = async (uri) => {
  const client = new MongoClient(uri)
  await client.connect()

  const db = client.db()

  // Create indexes for common queries
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

  console.log(`  MongoDB connected: ${db.databaseName}`)

  return { db, client }
}

export { connectDb }
