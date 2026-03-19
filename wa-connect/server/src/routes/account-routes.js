// GET  /api/accounts                — list user's connected accounts
// POST /api/accounts/connect        — manually connect an account (sandbox/dev)
// POST /api/accounts/callback       — Embedded Signup callback (production flow)
// GET  /api/accounts/:accountId/status — get account connection status

import { ObjectId } from 'mongodb'
import { createAccount } from '../db/accounts/create-account.js'
import { requireAuth } from '../middleware/require-auth.js'
import { exchangeToken } from '../meta/exchange-token.js'
import { fetchWabaPhoneNumbers } from '../meta/fetch-waba-phone-numbers.js'
import { subscribeWebhooks } from '../meta/subscribe-webhooks.js'

const registerAccountRoutes = (app, db, env) => {
  const auth = requireAuth(db, env)
  const metaOpts = { baseUrl: env.META_BASE_URL, isLocal: env.IS_LOCAL }

  // List accounts for current user
  app.get('/api/accounts', auth, async (req, res) => {
    const accounts = await db.collection('accounts')
      .find({ owner_user_id: new ObjectId(req.user._id) })
      .project({ access_token: 0 }) // Never expose tokens
      .toArray()

    res.json({ accounts })
  })

  // Connect account (dev/sandbox flow — manual with known credentials)
  app.post('/api/accounts/connect', auth, async (req, res) => {
    const { waba_id, phone_number_id, access_token, display_phone, business_name, meta_app_id, meta_app_secret } = req.body

    if (!waba_id || !phone_number_id || !access_token) {
      return res.status(400).json({
        error: 'waba_id, phone_number_id, and access_token are required',
      })
    }

    // Per-account Meta app credentials — fallback to env if not provided
    const accountAppId = meta_app_id || env.META_APP_ID || null
    const accountAppSecret = meta_app_secret || env.META_APP_SECRET || null

    if (accountAppId) {
      console.log(`  [ACCOUNT] Connecting with Meta App ID: ${accountAppId}`)
    }

    const result = await createAccount(db, {
      waba_id,
      phone_number_id,
      access_token,
      display_phone,
      business_name,
      meta_app_id: accountAppId,
      meta_app_secret: accountAppSecret,
      owner_user_id: req.user._id.toString(),
    })

    if (!result.ok) {
      return res.status(400).json({ error: result.error })
    }

    // Don't return the token in the response
    const { access_token: _, ...safe } = result.data
    res.status(201).json({ account: safe })
  })

  // Embedded Signup callback — the frontend sends us the code + session info
  //
  // Flow (working backwards from the end goal):
  //   Goal: account persisted in MongoDB, webhooks subscribed
  //   4. Persist the account → createAccount()
  //   3. Subscribe WABA to app webhooks → subscribeWebhooks()
  //   2. Fetch phone details for display_phone → fetchWabaPhoneNumbers()
  //   1. Exchange code for access_token → exchangeToken()
  //   0. Frontend POSTs { code, phone_number_id, waba_id }
  //
  app.post('/api/accounts/callback', auth, async (req, res) => {
    const { code, phone_number_id, waba_id } = req.body

    if (!code || !waba_id) {
      return res.status(400).json({
        error: 'code and waba_id are required (phone_number_id recommended)',
      })
    }

    // Step 1: Exchange code for access token
    const tokenResult = await exchangeToken(code, env.META_APP_ID, env.META_APP_SECRET, metaOpts)

    if (!tokenResult.ok) {
      console.error('  Embedded Signup: token exchange failed:', tokenResult.error)
      return res.status(502).json({ error: tokenResult.error })
    }

    const { access_token } = tokenResult.data

    // Step 2: Fetch phone number details (display phone, verified name)
    let display_phone = null
    let business_name = null
    let resolved_phone_number_id = phone_number_id || null

    const phoneResult = await fetchWabaPhoneNumbers(access_token, waba_id, metaOpts)

    if (phoneResult.ok && phoneResult.data?.data?.length > 0) {
      const phones = phoneResult.data.data

      // If frontend gave us a phone_number_id, find that specific one
      // Otherwise use the first phone number in the WABA
      const match = phone_number_id
        ? phones.find((p) => p.id === phone_number_id)
        : phones[0]

      if (match) {
        resolved_phone_number_id = match.id
        display_phone = match.display_phone_number || null
        business_name = match.verified_name || null
      }
    }

    if (!resolved_phone_number_id) {
      return res.status(400).json({
        error: 'Could not resolve phone_number_id — provide it explicitly or ensure the WABA has a registered phone number',
      })
    }

    // Step 3: Subscribe app to webhook events for this WABA
    const subResult = await subscribeWebhooks(access_token, waba_id, metaOpts)

    if (!subResult.ok) {
      // Non-fatal — log but continue. The user can re-subscribe later.
      console.warn('  Embedded Signup: webhook subscription failed:', subResult.error)
    }

    // Step 4: Persist the account — store env app credentials (Embedded Signup always uses env app)
    const accountResult = await createAccount(db, {
      waba_id,
      phone_number_id: resolved_phone_number_id,
      access_token,
      display_phone,
      business_name,
      meta_app_id: env.META_APP_ID || null,
      meta_app_secret: env.META_APP_SECRET || null,
      owner_user_id: req.user._id.toString(),
    })

    if (!accountResult.ok) {
      return res.status(400).json({ error: accountResult.error })
    }

    // Don't return the token
    const { access_token: _, ...safe } = accountResult.data
    res.status(201).json({
      account: safe,
      webhook_subscribed: subResult.ok,
    })
  })

  // Account status
  app.get('/api/accounts/:accountId/status', auth, async (req, res) => {
    const account = await db.collection('accounts').findOne(
      { _id: new ObjectId(req.params.accountId), owner_user_id: new ObjectId(req.user._id) },
      { projection: { status: 1, display_phone: 1, business_name: 1, updated_at: 1 } }
    )

    if (!account) {
      return res.status(404).json({ error: 'Account not found' })
    }

    res.json({ account })
  })
}

export { registerAccountRoutes }
