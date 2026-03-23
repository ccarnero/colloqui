import { ObjectId } from 'mongodb'
import { ok, err } from '../../lib/result.js'

const findContactByWaId = async (db, accountId, waId) => {
  try {
    const accId = typeof accountId === 'string' ? new ObjectId(accountId) : accountId

    // Try wa_id first (covers both phone and BSUID)
    let contact = await db.collection('contacts').findOne({
      account_id: accId,
      wa_id: waId,
    })

    // Fallback: search by bsuid or phone directly (in case wa_id changed)
    if (!contact) {
      contact = await db.collection('contacts').findOne({
        account_id: accId,
        $or: [{ bsuid: waId }, { phone: waId }],
      })
    }

    if (!contact) return err('Contact not found')

    return ok(contact)
  } catch (e) {
    return err(e.message)
  }
}

export { findContactByWaId }
