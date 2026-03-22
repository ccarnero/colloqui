// Verifies the Meta webhook subscription challenge.
// Meta sends a GET with hub.mode, hub.verify_token, and hub.challenge.
// We verify the token matches ours and respond with the challenge.

const verifyWebhook = (query, expectedToken) => {
  const mode = query['hub.mode']
  const token = query['hub.verify_token']
  const challenge = query['hub.challenge']

  if (mode === 'subscribe' && token === expectedToken) {
    return { verified: true, challenge }
  }

  return { verified: false, challenge: null }
}

export { verifyWebhook }
