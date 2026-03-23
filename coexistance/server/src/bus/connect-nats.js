// Creates a NATS Core connection.
// Returns ok(nc) on success, err(reason) on failure.
// The caller owns the connection — pass nc as an argument, never use a global.
//
// Note: En v1 (JetStream), también inicializará el JetStream context.

import { connect } from 'nats'
import { ok, err } from '../lib/result.js'

const connectNats = async (url = 'nats://localhost:4222') => {
  try {
    console.log(`  [NATS] Connecting to ${url}...`)
    const nc = await connect({ servers: url })
    console.log(`  [NATS] Connected to ${nc.getServer()}`)

    nc.closed().then(() => {
      console.log('  [NATS] Connection closed')
    })

    return ok(nc)
  } catch (e) {
    console.error(`  [NATS] Connection failed: ${e.message}`)
    return err(e.message || String(e))
  }
}

export { connectNats }
