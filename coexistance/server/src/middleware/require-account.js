// Express middleware that verifies the user owns the account in req.params.accountId.
// Must run AFTER requireAuth (needs req.user).

import { findAccount } from '../db/accounts/find-account.js'

const requireAccount = (db) => async (req, res, next) => {
  const { accountId } = req.params

  if (!accountId) {
    return res.status(400).json({ error: 'Missing accountId parameter' })
  }

  const result = await findAccount(db, { _id: accountId })

  if (!result.ok || !result.data) {
    return res.status(404).json({ error: 'Account not found' })
  }

  // Check ownership
  const userId = req.user._id.toString()
  const ownerId = result.data.owner_user_id.toString()

  if (userId !== ownerId) {
    return res.status(403).json({ error: 'Access denied to this account' })
  }

  req.account = result.data
  next()
}

export { requireAccount }
