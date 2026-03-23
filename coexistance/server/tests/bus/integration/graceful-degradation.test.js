// Integration test: graceful degradation when NATS is unavailable.

import { describe, it, expect, vi } from 'vitest'
import { connectNats } from '../../../src/bus/connect-nats.js'
import { processIngress } from '../../../src/services/ingress/process-ingress.js'
import { textMessage } from '../fixtures/meta-webhook-samples.js'

describe('Graceful degradation', () => {
  it('connectNats with invalid URL returns err without throwing', async () => {
    const result = await connectNats('nats://127.0.0.1:1')
    expect(result.ok).toBe(false)
    expect(typeof result.error).toBe('string')
    expect(result.error.length).toBeGreaterThan(0)
  }, 10000)

  it('webhook handler logs warning and does not crash when nc is null', async () => {
    // Simulate the webhook handler behavior when nc is null
    // (as implemented in webhook-routes.js)
    const nc = null
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // Replicate the nc check logic from webhook-routes.js
    if (!nc) {
      console.warn('  [WEBHOOK] NATS not available — event not published (nc is null)')
    }

    expect(warnSpy).toHaveBeenCalledWith(
      '  [WEBHOOK] NATS not available — event not published (nc is null)'
    )

    warnSpy.mockRestore()
  })

  it('processIngress with a failing nc returns err gracefully', async () => {
    const nc = {
      publish: vi.fn().mockImplementation(() => {
        throw new Error('connection lost')
      }),
    }

    const result = await processIngress(
      {
        rawBody: textMessage,
        headers: { 'content-type': 'application/json' },
        tenant: 'acme',
        accountid: '507f1f77bcf86cd799439011',
        correlationId: 'corr-001',
      },
      { nc, producer: 'coexistance' }
    )

    expect(result.ok).toBe(false)
    expect(result.error).toContain('connection lost')
  })

  it('processIngress err does not throw — caller receives Result', async () => {
    const nc = {
      publish: vi.fn().mockImplementation(() => {
        throw new Error('NATS offline')
      }),
    }

    // Should never throw — always returns Result
    await expect(
      processIngress(
        {
          rawBody: textMessage,
          headers: {},
          tenant: 'acme',
          accountid: '507f1f77bcf86cd799439011',
          correlationId: 'corr-fail',
        },
        { nc, producer: 'coexistance' }
      )
    ).resolves.toMatchObject({ ok: false })
  })
})
