// Persistence service — subscribes to NATS and saves messages to MongoDB.
// Starts the subscription. No routes.

import { subscribeToSubject } from '../../bus/subscribe.js'
import { createPersistMessageHandler } from './persist-message.js'

const startPersistence = ({ nc, db }) => {
  const handler = createPersistMessageHandler(db)
  const result = subscribeToSubject(nc, 'evt.*.coexistance.messaging.>', handler)

  if (result.ok) {
    console.log('  [SERVICE] Persistence started — subscribed to evt.*.coexistance.messaging.>')
  } else {
    console.error('  [SERVICE] Persistence FAILED to start:', result.error)
  }

  return result
}

export { startPersistence }
