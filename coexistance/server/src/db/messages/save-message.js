import { ObjectId } from 'mongodb'
import { ok, err } from '../../lib/result.js'

const saveMessage = async (db, message) => {
  try {
    const doc = {
      _id: new ObjectId(),
      account_id: typeof message.account_id === 'string'
        ? new ObjectId(message.account_id) : message.account_id,
      contact_id: typeof message.contact_id === 'string'
        ? new ObjectId(message.contact_id) : message.contact_id,
      wa_message_id: message.wa_message_id || null,
      wa_sender_id: message.wa_sender_id || null,
      direction: message.direction,   // "inbound" | "outbound"
      source: message.source || 'human',
      type: message.type,             // "text" | "template" | "image" | ...
      content: message.content,
      status: message.status || 'sent',
      status_history: [{ status: message.status || 'sent', timestamp: new Date() }],
      timestamp: message.timestamp ? new Date(message.timestamp) : new Date(),
      created_at: new Date(),
    }

    await db.collection('messages').insertOne(doc)
    return ok(doc)
  } catch (e) {
    return err(e.message)
  }
}

export { saveMessage }
