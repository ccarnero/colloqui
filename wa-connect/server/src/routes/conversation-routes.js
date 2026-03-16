// GET /api/accounts/:accountId/conversations           — list with last message
// GET /api/accounts/:accountId/conversations/:contactId — message history

import { ObjectId } from 'mongodb'
import { findMessages } from '../db/messages/find-messages.js'
import { requireAuth } from '../middleware/require-auth.js'
import { requireAccount } from '../middleware/require-account.js'

const registerConversationRoutes = (app, db, env) => {
  const auth = requireAuth(db, env)
  const account = requireAccount(db)

  // List conversations (contacts with their last message)
  app.get('/api/accounts/:accountId/conversations', auth, account, async (req, res) => {
    const accountId = new ObjectId(req.params.accountId)

    // Aggregate: join contacts with their latest message
    const conversations = await db.collection('contacts')
      .aggregate([
        { $match: { account_id: accountId } },
        { $sort: { last_message_at: -1 } },
        { $limit: 50 },
        {
          $lookup: {
            from: 'messages',
            let: { contactId: '$_id', accId: '$account_id' },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ['$contact_id', '$$contactId'] },
                      { $eq: ['$account_id', '$$accId'] },
                    ],
                  },
                },
              },
              { $sort: { created_at: -1 } },
              { $limit: 1 },
            ],
            as: 'last_message',
          },
        },
        { $unwind: { path: '$last_message', preserveNullAndEmptyArrays: true } },
      ])
      .toArray()

    res.json({ conversations })
  })

  // Message history for a specific contact
  app.get('/api/accounts/:accountId/conversations/:contactId', auth, account, async (req, res) => {
    const { accountId, contactId } = req.params
    const { limit, before } = req.query

    const result = await findMessages(db, accountId, contactId, {
      limit: limit ? Number(limit) : 50,
      before: before || null,
    })

    if (!result.ok) {
      return res.status(500).json({ error: result.error })
    }

    res.json({ messages: result.data })
  })
}

export { registerConversationRoutes }
