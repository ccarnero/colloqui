// Rule: if inbound text is exactly "ping" (case insensitive), reply "pong"
//
// Uses parseSenderId to normalize the phone number before returning the reply target.
// This handles Argentine numbers where Meta webhooks send 549... but the send API expects 54...

import { parseSenderId } from '../../../meta/parse-sender-id.js'

const pingPong = (messages) => {
  if (!messages || messages.length === 0) return null

  const msg = messages[0]
  if (msg.type !== 'text') return null

  const body = msg.text?.body?.toLowerCase().trim()
  if (body !== 'ping') return null

  const sender = parseSenderId(msg.from)

  return {
    rule: 'ping-pong',
    action: 'send_text',
    to: sender.value,
    text: 'pong',
  }
}

export { pingPong }
