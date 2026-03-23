import { ObjectId } from 'mongodb'
import { ok, err } from '../../lib/result.js'
import { hashPassword } from '../../auth/hash-password.js'

const createUser = async (db, { email, password, name }) => {
  try {
    const existing = await db.collection('users').findOne({ email })
    if (existing) {
      return err('Email already registered')
    }

    const passwordHash = await hashPassword(password)

    const doc = {
      _id: new ObjectId(),
      email,
      password_hash: passwordHash,
      name,
      role: 'admin',
      account_ids: [],
      created_at: new Date(),
    }

    await db.collection('users').insertOne(doc)

    // Return without password_hash
    const { password_hash, ...safe } = doc
    return ok(safe)
  } catch (e) {
    return err(e.message)
  }
}

export { createUser }
