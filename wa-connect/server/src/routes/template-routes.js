// GET /api/accounts/:accountId/templates — list templates from Meta

import { fetchTemplates } from '../meta/fetch-templates.js'
import { requireAuth } from '../middleware/require-auth.js'
import { requireAccount } from '../middleware/require-account.js'

const registerTemplateRoutes = (app, db, env) => {
  const auth = requireAuth(db, env)
  const account = requireAccount(db)
  const metaOpts = { baseUrl: env.META_BASE_URL, isLocal: env.IS_LOCAL }

  app.get('/api/accounts/:accountId/templates', auth, account, async (req, res) => {
    const result = await fetchTemplates(
      req.account.access_token,
      req.account.waba_id,
      metaOpts
    )

    if (!result.ok) {
      return res.status(502).json({ error: result.error })
    }

    res.json({ templates: result.data?.data || result.data })
  })
}

export { registerTemplateRoutes }
