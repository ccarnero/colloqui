// Evaluate all auto-reply rules against an incoming envelope.
// Returns the first matching rule result, or null if none match.
//
// To add a new rule: create a file in rules/, import it here, add to RULES array.

import { pingPong } from './rules/ping-pong.js'

const RULES = [pingPong]

const evaluateRules = (envelope) => {
  // Extract messages array from Meta webhook payload
  const messages = envelope?.data?.payload?.entry?.[0]?.changes?.[0]?.value?.messages
  if (!messages || messages.length === 0) return null

  for (const rule of RULES) {
    const match = rule(messages)
    if (match) return match
  }

  return null
}

export { evaluateRules }
