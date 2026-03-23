import jwt from 'jsonwebtoken'

const createToken = (userId, secret, expiresIn = '7d') =>
  jwt.sign({ sub: userId }, secret, { expiresIn })

export { createToken }
