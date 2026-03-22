import bcrypt from 'bcryptjs'

const SALT_ROUNDS = 10

const hashPassword = (plain) => bcrypt.hash(plain, SALT_ROUNDS)

export { hashPassword }
