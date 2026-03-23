// POST /api/auth/register — create user
// POST /api/auth/login    — authenticate and return JWT
// GET  /api/auth/me        — get current user from token

import { createUser } from '../db/users/create-user.js'
import { findUser } from '../db/users/find-user.js'
import { verifyPassword } from '../auth/verify-password.js'
import { createToken } from '../auth/create-token.js'
import { requireAuth } from '../middleware/require-auth.js'

const registerAuthRoutes = (app, db, env) => {
  app.post('/api/auth/register', async (req, res) => {
    const { email, password, name } = req.body

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'email, password, and name are required' })
    }

    const result = await createUser(db, { email, password, name })

    if (!result.ok) {
      return res.status(400).json({ error: result.error })
    }

    const token = createToken(result.data._id.toString(), env.JWT_SECRET, env.JWT_EXPIRES_IN)

    res.status(201).json({ user: result.data, token })
  })

  app.post('/api/auth/login', async (req, res) => {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ error: 'email and password are required' })
    }

    const result = await findUser(db, { email })

    if (!result.ok) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const valid = await verifyPassword(password, result.data.password_hash)
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const token = createToken(result.data._id.toString(), env.JWT_SECRET, env.JWT_EXPIRES_IN)

    const { password_hash, ...safe } = result.data
    res.json({ user: safe, token })
  })

  app.get('/api/auth/me', requireAuth(db, env), (req, res) => {
    const { password_hash, ...safe } = req.user
    res.json({ user: safe })
  })
}

export { registerAuthRoutes }
