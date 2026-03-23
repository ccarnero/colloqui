// POST /api/accounts/:accountId/messages/send           — send text reply
// POST /api/accounts/:accountId/messages/send-template  — send template
// After responding, fires processEgress to publish the outbound event to NATS.

import { sendText } from '../../meta/send-text.js'
import { sendTemplate } from '../../meta/send-template.js'
import { saveMessage } from '../../db/messages/save-message.js'
import { findContactByWaId } from '../../db/contacts/find-contact-by-wa-id.js'
import { requireAuth } from '../../middleware/require-auth.js'
import { requireAccount } from '../../middleware/require-account.js'
import { processEgress } from './process-egress.js'

const registerMessageRoutes = (app, db, env, busConfig = {}) => {
  const { nc, metrics } = busConfig
  const auth = requireAuth(db, env)
  const account = requireAccount(db)
  const metaOpts = { baseUrl: env.META_BASE_URL, isLocal: env.IS_LOCAL }

  // Send text reply
  app.post('/api/accounts/:accountId/messages/send', auth, account, async (req, res) => {
    const { to, text } = req.body

    if (!to || !text) {
      return res.status(400).json({ error: 'to and text are required' })
    }

    const result = await sendText(
      req.account.access_token,
      req.account.phone_number_id,
      to,
      text,
      metaOpts
    )

    if (!result.ok) {
      return res.status(502).json({ error: result.error })
    }

    // Find contact to associate the message
    const contactResult = await findContactByWaId(db, req.account._id, to)

    // Save outbound message
    await saveMessage(db, {
      account_id: req.account._id,
      contact_id: contactResult.ok ? contactResult.data._id : null,
      wa_message_id: result.data?.messages?.[0]?.id || result.data?.message_id || null,
      wa_sender_id: to,
      direction: 'outbound',
      source: 'human',
      type: 'text',
      content: { text },
      status: 'sent',
    })

    res.json({ success: true, data: result.data })

    // Fire-and-forget: publish outbound event to NATS
    if (nc) {
      processEgress(
        {
          body: { to, text, type: 'text' },
          tenant: req.account.tenant || 'default',
          accountid: String(req.account._id),
          correlationId: result.data?.messages?.[0]?.id || null,
        },
        { nc, producer: 'coexistance', metrics }
      ).catch((e) => console.error(`  [EGRESS] fire-and-forget failed: ${e.message}`))
    }
  })

  // Send template
  app.post('/api/accounts/:accountId/messages/send-template', auth, account, async (req, res) => {
    const { to, template_name, language_code, components } = req.body

    if (!to || !template_name) {
      return res.status(400).json({ error: 'to and template_name are required' })
    }

    const result = await sendTemplate(
      req.account.access_token,
      req.account.phone_number_id,
      to,
      template_name,
      language_code || 'en_US',
      components || [],
      metaOpts
    )

    if (!result.ok) {
      return res.status(502).json({ error: result.error })
    }

    // Find contact
    const contactResult = await findContactByWaId(db, req.account._id, to)

    // Save outbound template message
    await saveMessage(db, {
      account_id: req.account._id,
      contact_id: contactResult.ok ? contactResult.data._id : null,
      wa_message_id: result.data?.messages?.[0]?.id || result.data?.message_id || null,
      wa_sender_id: to,
      direction: 'outbound',
      source: 'template',
      type: 'template',
      content: { template_name, language_code: language_code || 'en_US' },
      status: 'sent',
    })

    res.json({ success: true, data: result.data })

    // Fire-and-forget: publish outbound event to NATS
    if (nc) {
      processEgress(
        {
          body: { to, template_name, language_code: language_code || 'en_US', type: 'template' },
          tenant: req.account.tenant || 'default',
          accountid: String(req.account._id),
          correlationId: result.data?.messages?.[0]?.id || null,
        },
        { nc, producer: 'coexistance', metrics }
      ).catch((e) => console.error(`  [EGRESS] fire-and-forget failed: ${e.message}`))
    }
  })
}

export { registerMessageRoutes }
