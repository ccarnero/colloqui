import { ObjectId } from 'mongodb'
import { ok, err } from '../../lib/result.js'

const findUser = async (db, query) => {
  try {
    // If querying by _id string, convert to ObjectId
    const q = { ...query }
    if (typeof q._id === 'string') {
      q._id = new ObjectId(q._id)
    }

    const user = await db.collection('users').findOne(q)
    if (!user) return err('User not found')

    return ok(user)
  } catch (e) {
    return err(e.message)
  }
}

export { findUser }
