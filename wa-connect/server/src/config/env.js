// Reads and validates environment variables at startup.
// Fails fast if required vars are missing — no silent nulls at runtime.

import { config } from 'dotenv'
import { resolve } from 'path'

const readEnv = () => {
  // Load from project root .env
  config({ path: resolve(import.meta.dir, '../../../.env') })

  const required = [
    'MONGODB_URI',
    'JWT_SECRET',
    'META_VERIFY_TOKEN',
  ]

  const optional = {
    PORT: '6666',
    NODE_ENV: 'development',
    META_API_VERSION: 'v22.0',
    META_APP_ID: '',
    META_APP_SECRET: '',
    META_CONFIG_ID: '',
    META_PHONE_NUMBER_ID: '',
    META_ACCESS_TOKEN: '',
    META_WABA_ID: '',
    JWT_EXPIRES_IN: '7d',
    LOCAL_TESTING: 'true',
  }

  const missing = required.filter((key) => !process.env[key])

  if (missing.length > 0) {
    console.error(`\n  Missing required env vars: ${missing.join(', ')}`)
    console.error(`  Copy .env.example to .env and fill in the values.\n`)
    process.exit(1)
  }

  const env = {}

  for (const key of required) {
    env[key] = process.env[key]
  }

  for (const [key, fallback] of Object.entries(optional)) {
    env[key] = process.env[key] || fallback
  }

  // Derived
  env.IS_LOCAL = env.LOCAL_TESTING === 'true'
  env.META_BASE_URL = `https://graph.facebook.com/${env.META_API_VERSION}`

  return Object.freeze(env)
}

export { readEnv }
