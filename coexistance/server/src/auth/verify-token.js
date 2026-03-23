import jwt from 'jsonwebtoken'
import { ok, err } from '../lib/result.js'

const verifyToken = (token, secret) => {
  try {
    const payload = jwt.verify(token, secret)
    return ok(payload)
  } catch (e) {
    return err(e.message)
  }
}

export { verifyToken }
