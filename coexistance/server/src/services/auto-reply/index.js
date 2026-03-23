// Auto-reply service — subscribes to inbound NATS events,
// evaluates rules, and sends automatic responses.
//
// Zero coupling with ingress, persistence, or SSE.
// To add rules: create a file in rules/ and register it in evaluate-rules.js.

import { ObjectId } from 'mongodb'
import { subscribeToSubject } from '../../bus/subscribe.js'
import { evaluateRules } from './evaluate-rules.js'
import { executeReply } from './execute-reply.js'

const startAutoReply = ({ nc, db, env, metrics }) => {
  const subject = 'evt.*.coexistance.messaging.whatsapp.meta.received.v1'

  const handler = async (envelope) => {
    console.log(`  [AUTO-REPLY] Processing envelope id=${envelope.id} (no dedup in v0)`)

    const match = evaluateRules(envelope)
    if (!match) return

    const accountId = envelope.accountid
    if (!accountId) {
      console.warn('  [AUTO-REPLY] No accountId in envelope — skip')
      return
    }

    console.log(`  [AUTO-REPLY] Rule matched: "${match.rule}" — account=${accountId} to=${match.to}`)

    // Load account from DB to get access_token + phone_number_id
    let account
    try {
      account = await db.collection('accounts').findOne({ _id: new ObjectId(accountId) })
    } catch (e) {
      console.error(`  [AUTO-REPLY] Invalid accountId "${accountId}": ${e.message}`)
      return
    }

    if (!account) {
      console.error(`  [AUTO-REPLY] Account not found: ${accountId}`)
      return
    }

    if (!account.access_token || !account.phone_number_id) {
      console.error(`  [AUTO-REPLY] Account ${accountId} missing access_token or phone_number_id`)
      return
    }

    const result = await executeReply(match, account, db, env, { nc, metrics })

    if (result.ok) {
      console.log(`  [AUTO-REPLY] Done — wa_message_id=${result.data.waMessageId}`)
    } else {
      console.error(`  [AUTO-REPLY] Failed — ${result.error}`)
    }
  }

  const subResult = subscribeToSubject(nc, subject, handler)

  if (subResult.ok) {
    console.log(`  [SERVICE] Auto-reply registered — subject: ${subject}`)
  } else {
    console.error(`  [SERVICE] Auto-reply failed to subscribe: ${subResult.error}`)
  }

  return subResult
}

export { startAutoReply }
