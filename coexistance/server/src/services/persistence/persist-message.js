// Persistence consumer — subscribes to NATS and saves messages to MongoDB.
// This replaces the inline persistence that previously lived in webhook-routes.js.
// Handles both 'message' and 'status' event types from the parsed webhook.

import { parseWebhook } from '../../meta/parse-webhook.js'
import { upsertContact } from '../../db/contacts/upsert-contact.js'
import { saveMessage } from '../../db/messages/save-message.js'
import { updateMessageStatus } from '../../db/messages/update-status.js'

// Returns an async handler function bound to the given db instance.
const createPersistMessageHandler = (db) => async (envelope) => {
  const rawBody = envelope?.data?.payload

  if (!rawBody) {
    console.warn('  [PERSIST] envelope missing data.payload — skipping')
    return
  }

  const event = parseWebhook(rawBody)
  console.log(`  [PERSIST] envelope id=${envelope.id} parsed type=${event.type}`)

  if (event.type === 'message') {
    await handleMessage(db, envelope, event.data)
  } else if (event.type === 'status') {
    await handleStatus(db, event.data)
  } else {
    console.log(`  [PERSIST] unknown event type — skipping`)
  }
}

const handleMessage = async (db, envelope, data) => {
  const accountid = envelope.accountid

  // Find the account
  const account = await db.collection('accounts').findOne({
    phone_number_id: data.phone_number_id,
  })

  if (!account) {
    console.warn(`  [PERSIST] NO ACCOUNT FOUND for phone_number_id: "${data.phone_number_id}"`)
    return
  }

  console.log(`  [PERSIST] Matched account: ${account.business_name} (${account._id})`)

  // Upsert contact
  const contactResult = await upsertContact(db, account._id, data.sender, data.profile_name)
  if (!contactResult.ok) {
    console.error(`  [PERSIST] Failed to upsert contact: ${contactResult.error}`)
    return
  }

  // Save message
  const msgResult = await saveMessage(db, {
    account_id: account._id,
    contact_id: contactResult.data._id,
    wa_message_id: data.wa_message_id,
    wa_sender_id: data.sender.value,
    direction: 'inbound',
    source: 'human',
    type: data.message_type,
    content: data.content,
    status: 'received',
    timestamp: data.timestamp,
  })

  if (msgResult.ok) {
    console.log(`  [PERSIST] Message saved: ${data.message_type} from ${data.sender.value} (${data.sender.type})`)
  } else {
    console.error(`  [PERSIST] Failed to save message: ${msgResult.error}`)
  }
}

const handleStatus = async (db, data) => {
  const result = await updateMessageStatus(db, data.wa_message_id, data.status)

  if (result.ok) {
    console.log(`  [PERSIST] Status updated: ${data.wa_message_id} → ${data.status}`)
  } else {
    console.error(`  [PERSIST] Failed to update status: ${result.error}`)
  }
}

export { createPersistMessageHandler }
