// Creates or updates a contact based on the sender ID from a webhook.
// BSUID-aware: finds by wa_id within the account, creates with proper identifier_type.
// If a contact previously had only a phone and now also has a BSUID (or vice versa),
// we merge both identifiers onto the same contact doc.

import { ObjectId } from 'mongodb'
import { ok, err } from '../../lib/result.js'

const upsertContact = async (db, accountId, senderInfo, profileName = null) => {
  try {
    const accId = typeof accountId === 'string' ? new ObjectId(accountId) : accountId

    const filter = { account_id: accId, wa_id: senderInfo.value }

    const updateFields = {
      wa_id: senderInfo.value,
      identifier_type: senderInfo.type,
      last_message_at: new Date(),
    }

    // Set the appropriate identifier field
    if (senderInfo.type === 'phone') {
      updateFields.phone = senderInfo.normalized
    } else if (senderInfo.type === 'bsuid') {
      updateFields.bsuid = senderInfo.value
    }

    if (profileName) {
      updateFields.display_name = profileName
    }

    const result = await db.collection('contacts').findOneAndUpdate(
      filter,
      {
        $set: updateFields,
        $setOnInsert: {
          _id: new ObjectId(),
          account_id: accId,
          created_at: new Date(),
        },
      },
      { upsert: true, returnDocument: 'after' }
    )

    return ok(result)
  } catch (e) {
    return err(e.message)
  }
}

export { upsertContact }
