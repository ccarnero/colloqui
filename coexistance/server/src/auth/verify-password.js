import bcrypt from 'bcryptjs'

const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash)

export { verifyPassword }
