// Express middleware that verifies JWT from Authorization header.
// On success, attaches user doc to req.user.
// Returns a closure over db and env — no globals.

import { verifyToken } from '../auth/verify-token.js'
import { findUser } from '../db/users/find-user.js'

const requireAuth = (db, env) => async (req, res, next) => {
  const header = req.headers.authorization
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' })
  }

  const token = header.slice(7)
  const result = verifyToken(token, env.JWT_SECRET)

  if (!result.ok) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }

  const userResult = await findUser(db, { _id: result.data.sub })
  if (!userResult.ok) {
    return res.status(401).json({ error: 'User not found' })
  }

  req.user = userResult.data
  next()
}

export { requireAuth }
