import { ObjectId } from 'mongodb'
import { ok, err } from '../../lib/result.js'

const findAccount = async (db, query) => {
  try {
    const q = { ...query }
    if (typeof q._id === 'string') {
      q._id = new ObjectId(q._id)
    }
    if (typeof q.owner_user_id === 'string') {
      q.owner_user_id = new ObjectId(q.owner_user_id)
    }

    const account = await db.collection('accounts').findOne(q)
    if (!account) return err('Account not found')

    return ok(account)
  } catch (e) {
    return err(e.message)
  }
}

export { findAccount }
