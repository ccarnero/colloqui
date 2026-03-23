import { describe, it, expect, vi } from 'vitest'
import { evaluateRules } from '../../../src/services/auto-reply/evaluate-rules.js'

const fullEnvelope = {
  specversion: '1.0',
  id: '01KMBZ6FY8ZWB349026F71TXS2',
  tenant: 'default',
  producer: 'coexistance',
  domain: 'messaging',
  channel: 'whatsapp',
  provider: 'meta',
  accountid: '69bea8cd868e860918359cc7',
  data: {
    payload_inline: true,
    payload: {
      object: 'whatsapp_business_account',
      entry: [{
        id: '123',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: '100904' },
            messages: [{
              from: '541134602008',
              id: 'wamid.xxx',
              timestamp: '1711152000',
              type: 'text',
              text: { body: 'ping' },
            }],
          },
          field: 'messages',
        }],
      }],
    },
  },
}

describe('auto-reply integration', () => {
  it('evaluates full Meta envelope and returns correct match', () => {
    const match = evaluateRules(fullEnvelope)
    expect(match).toEqual({
      rule: 'ping-pong',
      action: 'send_text',
      to: '541134602008',
      text: 'pong',
    })
  })

  it('returns null for status update webhook (no messages)', () => {
    const statusEnvelope = {
      ...fullEnvelope,
      data: {
        payload: {
          entry: [{
            changes: [{
              value: {
                statuses: [{ id: 'wamid.xxx', status: 'delivered' }],
              },
            }],
          }],
        },
      },
    }
    expect(evaluateRules(statusEnvelope)).toBeNull()
  })

  it('returns null for non-ping message', () => {
    const helloEnvelope = structuredClone(fullEnvelope)
    helloEnvelope.data.payload.entry[0].changes[0].value.messages[0].text.body = 'hola'
    expect(evaluateRules(helloEnvelope)).toBeNull()
  })

  it('returns null for image message', () => {
    const imageEnvelope = structuredClone(fullEnvelope)
    imageEnvelope.data.payload.entry[0].changes[0].value.messages[0] = {
      from: '541134602008',
      type: 'image',
      image: { id: 'img-001' },
    }
    expect(evaluateRules(imageEnvelope)).toBeNull()
  })

  it('handles "PING" case insensitively', () => {
    const upperEnvelope = structuredClone(fullEnvelope)
    upperEnvelope.data.payload.entry[0].changes[0].value.messages[0].text.body = 'PING'
    const match = evaluateRules(upperEnvelope)
    expect(match).not.toBeNull()
    expect(match.text).toBe('pong')
  })
})
