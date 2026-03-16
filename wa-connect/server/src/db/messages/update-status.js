import { ok, err } from '../../lib/result.js'

const updateMessageStatus = async (db, waMessageId, status) => {
  try {
    const result = await db.collection('messages').findOneAndUpdate(
      { wa_message_id: waMessageId },
      {
        $set: { status },
        $push: { status_history: { status, timestamp: new Date() } },
      },
      { returnDocument: 'after' }
    )

    if (!result) return err('Message not found')

    return ok(result)
  } catch (e) {
    return err(e.message)
  }
}

export { updateMessageStatus }
