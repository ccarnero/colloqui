// GET  /api/webhooks/whatsapp  — Meta verification challenge
// POST /api/webhooks/whatsapp  — Incoming messages and status updates
//
// This is the heart of the system. Every WhatsApp message flows through here.
// BSUID-aware from day 1.

import { verifyWebhook } from '../meta/verify-webhook.js'
import { parseWebhook } from '../meta/parse-webhook.js'
import { upsertContact } from '../db/contacts/upsert-contact.js'
import { saveMessage } from '../db/messages/save-message.js'
import { updateMessageStatus } from '../db/messages/update-status.js'

const registerWebhookRoutes = (app, db, env, broadcast = () => {}) => {
  // Verification challenge — Meta sends this when you register the webhook URL
  app.get('/api/webhooks/whatsapp', (req, res) => {
    console.log('  [WEBHOOK] GET verification request')
    console.log('    mode:', req.query['hub.mode'])
    console.log('    token:', req.query['hub.verify_token'] ? '***' + req.query['hub.verify_token'].slice(-4) : 'MISSING')
    console.log('    challenge:', req.query['hub.challenge'] ? 'present' : 'MISSING')

    const result = verifyWebhook(req.query, env.META_VERIFY_TOKEN)

    if (result.verified) {
      console.log('  [WEBHOOK] Verified OK — responding with challenge')
      return res.status(200).send(result.challenge)
    }

    console.warn('  [WEBHOOK] Verification FAILED — token mismatch or missing params')
    res.status(403).send('Forbidden')
  })

  // Incoming events — respond 200 immediately, process async
  app.post('/api/webhooks/whatsapp', async (req, res) => {
    console.log('  [WEBHOOK] POST incoming event')
    console.log('    object:', req.body?.object)
    console.log('    entries:', req.body?.entry?.length || 0)

    // Always respond 200 fast — Meta retries on timeout
    res.status(200).send('EVENT_RECEIVED')

    try {
      const event = parseWebhook(req.body)
      console.log('    parsed type:', event.type)

      if (event.type === 'message') {
        console.log('    message from:', event.data.sender?.value, '| type:', event.data.message_type)
        await handleIncomingMessage(db, env, event.data, broadcast)
      } else if (event.type === 'status') {
        console.log('    status:', event.data.status, '| msg_id:', event.data.wa_message_id)
        await handleStatusUpdate(db, event.data, broadcast)
      } else {
        console.log('    unknown event — raw keys:', Object.keys(req.body || {}))
      }
    } catch (e) {
      // Log but don't crash — the 200 is already sent
      console.error('  [WEBHOOK] Processing error:', e.message)
      console.error('    stack:', e.stack?.split('\n')[1]?.trim())
    }
  })
}

// --- Internal handlers ---

const handleIncomingMessage = async (db, env, data, broadcast) => {
  // Find the account by phone_number_id (the business number that received the message)
  const account = await db.collection('accounts').findOne({
    phone_number_id: data.phone_number_id,
  })

  if (!account) {
    console.warn(`  [WEBHOOK] NO ACCOUNT FOUND for phone_number_id: "${data.phone_number_id}"`)
    console.warn(`    Check that your account in MongoDB has this exact phone_number_id`)
    console.warn(`    (not the phone number like +15551541722, but the Meta numeric ID)`)
    return
  }

  console.log(`  [WEBHOOK] Matched account: ${account.business_name} (${account._id})`)

  // Upsert contact (BSUID-aware)
  const contactResult = await upsertContact(
    db,
    account._id,
    data.sender,
    data.profile_name
  )

  if (!contactResult.ok) {
    console.error('  Failed to upsert contact:', contactResult.error)
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
    console.log(`  Message saved: ${data.message_type} from ${data.sender.value} (${data.sender.type})`)

    // Broadcast to connected dashboard clients
    broadcast(account._id, {
      type: 'new_message',
      data: {
        account_id: account._id.toString(),
        contact_id: contactResult.data._id.toString(),
        message: msgResult.data,
      },
    })
  }
}

const handleStatusUpdate = async (db, data, broadcast) => {
  const result = await updateMessageStatus(db, data.wa_message_id, data.status)

  if (result.ok) {
    console.log(`  Status updated: ${data.wa_message_id} → ${data.status}`)

    // Broadcast status change (find account from the message)
    if (result.data?.account_id) {
      broadcast(result.data.account_id, {
        type: 'status_update',
        data: {
          account_id: result.data.account_id.toString(),
          wa_message_id: data.wa_message_id,
          status: data.status,
        },
      })
    }
  }
}

export { registerWebhookRoutes }
