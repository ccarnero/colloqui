// Execute an auto-reply action: send via Meta API, save to DB, publish to NATS.
//
// Bypasses HTTP + auth — calls sendText and saveMessage directly.
// This is the "Opción A" approach for internal service-to-service calls.
// Returns ok({ waMessageId, rule, to, text }) or err(reason).

import { ok, err } from '../../lib/result.js'
import { sendText } from '../../meta/send-text.js'
import { saveMessage } from '../../db/messages/save-message.js'
import { processEgress } from '../egress/process-egress.js'

const executeReply = async (match, account, db, env, busConfig = {}) => {
  const { to, text, rule } = match
  const accountId = account._id.toString()
  const metaOpts = { baseUrl: env.META_BASE_URL, isLocal: env.IS_LOCAL }

  console.log(`  [AUTO-REPLY] Executing rule="${rule}" → sendText to=${to} text="${text}"`)

  // 1. Send via Meta API
  const sendResult = await sendText(
    account.access_token,
    account.phone_number_id,
    to,
    text,
    metaOpts
  )

  if (!sendResult.ok) {
    console.error(`  [AUTO-REPLY] sendText failed: ${sendResult.error}`)
    return err(`sendText failed: ${sendResult.error}`)
  }

  const waMessageId = sendResult.data?.messages?.[0]?.id || sendResult.data?.message_id || 'unknown'
  console.log(`  [AUTO-REPLY] sendText ok — wa_message_id=${waMessageId}`)

  // 2. Save to MongoDB
  const saveResult = await saveMessage(db, {
    account_id: account._id,
    contact_id: null,
    wa_message_id: waMessageId,
    wa_sender_id: to,
    direction: 'outbound',
    source: 'auto-reply',
    type: 'text',
    content: { text },
    status: 'sent',
  })

  if (!saveResult.ok) {
    // Non-fatal — message was already sent via Meta
    console.warn(`  [AUTO-REPLY] saveMessage failed (non-fatal): ${saveResult.error}`)
  } else {
    console.log(`  [AUTO-REPLY] Message saved to DB`)
  }

  // 3. Fire-and-forget: publish outbound event to NATS
  if (busConfig.nc) {
    processEgress(
      {
        body: { to, text, type: 'text' },
        tenant: account.tenant || 'default',
        accountid: accountId,
        correlationId: waMessageId,
      },
      { nc: busConfig.nc, producer: 'coexistance', metrics: busConfig.metrics }
    ).then((r) => {
      if (r.ok) console.log(`  [AUTO-REPLY] NATS egress published: ${r.data.eventId}`)
      else console.warn(`  [AUTO-REPLY] NATS egress failed (non-fatal): ${r.error}`)
    }).catch((e) => {
      console.error(`  [AUTO-REPLY] NATS egress unexpected error: ${e.message}`)
    })
  }

  return ok({ waMessageId, rule, to, text })
}

export { executeReply }
