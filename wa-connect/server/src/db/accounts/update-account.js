import { ObjectId } from 'mongodb'
import { ok, err } from '../../lib/result.js'

const updateAccount = async (db, id, data) => {
  try {
    const _id = typeof id === 'string' ? new ObjectId(id) : id

    const result = await db.collection('accounts').findOneAndUpdate(
      { _id },
      { $set: { ...data, updated_at: new Date() } },
      { returnDocument: 'after' }
    )

    if (!result) return err('Account not found')

    return ok(result)
  } catch (e) {
    return err(e.message)
  }
}

export { updateAccount }
