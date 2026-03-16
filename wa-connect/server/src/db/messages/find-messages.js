import { ObjectId } from 'mongodb'
import { ok, err } from '../../lib/result.js'

const findMessages = async (db, accountId, contactId, { limit = 50, before = null } = {}) => {
  try {
    const filter = {
      account_id: typeof accountId === 'string' ? new ObjectId(accountId) : accountId,
      contact_id: typeof contactId === 'string' ? new ObjectId(contactId) : contactId,
    }

    if (before) {
      filter.created_at = { $lt: new Date(before) }
    }

    const messages = await db.collection('messages')
      .find(filter)
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray()

    return ok(messages.reverse()) // Return in chronological order
  } catch (e) {
    return err(e.message)
  }
}

export { findMessages }
