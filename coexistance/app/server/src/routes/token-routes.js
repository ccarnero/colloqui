// GET  /api/accounts/:accountId/token-status  — check token health
// POST /api/accounts/:accountId/token-refresh  — exchange for long-lived token
// POST /api/accounts/:accountId/token-update   — manually paste a new token
//
// All routes require auth + account ownership.

import { ObjectId } from 'mongodb'
import { requireAuth } from '../middleware/require-auth.js'
import { refreshToken } from '../meta/refresh-token.js'

const registerTokenRoutes = (app, db, env) => {
  const auth = requireAuth(db, env)
  const metaOpts = { baseUrl: env.META_BASE_URL, isLocal: env.IS_LOCAL }

  // Find account owned by current user (returns null if not found)
  const findOwnedAccount = async (userId, accountId) => {
    try {
      return await db.collection('accounts').findOne({
        _id: new ObjectId(accountId),
        owner_user_id: new ObjectId(userId),
      })
    } catch {
      return null
    }
  }

  // Token status — returns expiration info without exposing the token
  app.get('/api/accounts/:accountId/token-status', auth, async (req, res) => {
    const account = await findOwnedAccount(req.user._id, req.params.accountId)

    if (!account) {
      return res.status(404).json({ error: 'Account not found' })
    }

    const now = Date.now()
    const expiresAt = account.token_expires_at ? new Date(account.token_expires_at).getTime() : null
    const hasToken = !!account.access_token

    // Determine status: connected | expiring_soon | expired | no_token
    const status = !hasToken
      ? 'no_token'
      : !expiresAt
        ? 'unknown' // has token but no expiration tracked — could be system user token
        : expiresAt < now
          ? 'expired'
          : expiresAt < now + 7 * 24 * 60 * 60 * 1000
            ? 'expiring_soon'
            : 'connected'

    const daysRemaining = expiresAt
      ? Math.max(0, Math.round((expiresAt - now) / (24 * 60 * 60 * 1000)))
      : null

    console.log(`  [TOKEN] Status for ${account.business_name}: ${status} (${daysRemaining} days remaining)`)

    res.json({
      status,
      has_token: hasToken,
      expires_at: account.token_expires_at || null,
      days_remaining: daysRemaining,
      token_refreshed_at: account.token_refreshed_at || null,
      business_name: account.business_name,
      display_phone: account.display_phone,
      waba_id: account.waba_id,
      phone_number_id: account.phone_number_id,
      meta_app_id: account.meta_app_id || null,
    })
  })

  // Refresh token — exchanges current token for a long-lived one via Meta API
  app.post('/api/accounts/:accountId/token-refresh', auth, async (req, res) => {
    const account = await findOwnedAccount(req.user._id, req.params.accountId)

    if (!account) {
      return res.status(404).json({ error: 'Account not found' })
    }

    if (!account.access_token) {
      return res.status(400).json({ error: 'No token to refresh — paste a new token first' })
    }

    // Use per-account credentials, fallback to env
    const appId = account.meta_app_id || env.META_APP_ID
    const appSecret = account.meta_app_secret || env.META_APP_SECRET

    if (!appId || !appSecret) {
      return res.status(400).json({ error: 'No Meta app credentials configured for this account. Update them in Account Settings.' })
    }

    console.log(`  [TOKEN] Refreshing token for ${account.business_name} (app: ${appId})...`)

    const result = await refreshToken(
      account.access_token,
      appId,
      appSecret,
      metaOpts
    )

    if (!result.ok) {
      return res.status(502).json({ error: result.error })
    }

    const { access_token, expires_in } = result.data
    const expiresAt = new Date(Date.now() + expires_in * 1000)

    await db.collection('accounts').updateOne(
      { _id: account._id },
      {
        $set: {
          access_token,
          token_expires_at: expiresAt,
          token_refreshed_at: new Date(),
          updated_at: new Date(),
        },
      }
    )

    console.log(`  [TOKEN] Refreshed OK — new expiration: ${expiresAt.toISOString()}`)

    res.json({
      status: 'connected',
      expires_at: expiresAt.toISOString(),
      days_remaining: Math.round(expires_in / 86400),
    })
  })

  // Manual token update — user pastes a new short-lived token from Meta dashboard
  app.post('/api/accounts/:accountId/token-update', auth, async (req, res) => {
    const { access_token } = req.body

    if (!access_token || typeof access_token !== 'string' || access_token.trim().length < 10) {
      return res.status(400).json({ error: 'A valid access_token is required' })
    }

    const account = await findOwnedAccount(req.user._id, req.params.accountId)

    if (!account) {
      return res.status(404).json({ error: 'Account not found' })
    }

    // Use per-account credentials, fallback to env
    const appId = account.meta_app_id || env.META_APP_ID
    const appSecret = account.meta_app_secret || env.META_APP_SECRET

    console.log(`  [TOKEN] Manual token update for ${account.business_name} (app: ${appId || 'NONE'})`)

    // Try to exchange it for a long-lived token immediately
    const refreshResult = (appId && appSecret)
      ? await refreshToken(access_token.trim(), appId, appSecret, metaOpts)
      : { ok: false, error: 'No Meta app credentials — saved as short-lived' }

    let finalToken = access_token.trim()
    let expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // assume 24h if exchange fails

    if (refreshResult.ok) {
      finalToken = refreshResult.data.access_token
      expiresAt = new Date(Date.now() + refreshResult.data.expires_in * 1000)
      console.log(`  [TOKEN] Auto-exchanged to long-lived token — expires: ${expiresAt.toISOString()}`)
    } else {
      console.warn(`  [TOKEN] Could not auto-exchange — saving as short-lived: ${refreshResult.error}`)
    }

    await db.collection('accounts').updateOne(
      { _id: account._id },
      {
        $set: {
          access_token: finalToken,
          token_expires_at: expiresAt,
          token_refreshed_at: new Date(),
          status: 'active',
          updated_at: new Date(),
        },
      }
    )

    res.json({
      status: refreshResult.ok ? 'connected' : 'expiring_soon',
      exchanged: refreshResult.ok,
      expires_at: expiresAt.toISOString(),
      days_remaining: Math.round((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)),
    })
  })
  // Update Meta app credentials for an account
  app.post('/api/accounts/:accountId/meta-credentials', auth, async (req, res) => {
    const { meta_app_id, meta_app_secret } = req.body

    if (!meta_app_id || !meta_app_secret) {
      return res.status(400).json({ error: 'meta_app_id and meta_app_secret are required' })
    }

    const account = await findOwnedAccount(req.user._id, req.params.accountId)

    if (!account) {
      return res.status(404).json({ error: 'Account not found' })
    }

    console.log(`  [TOKEN] Updating Meta credentials for ${account.business_name} → app: ${meta_app_id}`)

    await db.collection('accounts').updateOne(
      { _id: account._id },
      {
        $set: {
          meta_app_id: meta_app_id.trim(),
          meta_app_secret: meta_app_secret.trim(),
          updated_at: new Date(),
        },
      }
    )

    res.json({ updated: true, meta_app_id: meta_app_id.trim() })
  })
}

export { registerTokenRoutes }
