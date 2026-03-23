import { describe, it, expect } from 'vitest'
import { parseWebhook } from '../src/meta/parse-webhook.js'

describe('parseWebhook', () => {
  it('parses a text message', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba_123',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'phone_123' },
            contacts: [{ profile: { name: 'Test User' }, wa_id: '5215512345678' }],
            messages: [{
              id: 'msg_001',
              from: '5215512345678',
              timestamp: '1710000000',
              type: 'text',
              text: { body: 'Hello there!' },
            }],
          },
          field: 'messages',
        }],
      }],
    }

    const event = parseWebhook(body)
    expect(event.type).toBe('message')
    expect(event.data.message_type).toBe('text')
    expect(event.data.content.text).toBe('Hello there!')
    expect(event.data.sender.value).toBe('5215512345678')
    expect(event.data.phone_number_id).toBe('phone_123')
    expect(event.data.profile_name).toBe('Test User')
  })

  it('parses a status update', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'waba_123',
        changes: [{
          value: {
            messaging_product: 'whatsapp',
            metadata: { phone_number_id: 'phone_123' },
            statuses: [{
              id: 'msg_001',
              status: 'delivered',
              timestamp: '1710000000',
              recipient_id: '5215512345678',
            }],
          },
          field: 'messages',
        }],
      }],
    }

    const event = parseWebhook(body)
    expect(event.type).toBe('status')
    expect(event.data.wa_message_id).toBe('msg_001')
    expect(event.data.status).toBe('delivered')
  })

  it('returns unknown for empty body', () => {
    const event = parseWebhook({})
    expect(event.type).toBe('unknown')
  })

  it('parses image message', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: 'phone_123' },
            contacts: [{ profile: { name: 'User' }, wa_id: '123' }],
            messages: [{
              id: 'msg_002',
              from: '123',
              timestamp: '1710000000',
              type: 'image',
              image: { id: 'media_123', mime_type: 'image/jpeg', caption: 'Look at this' },
            }],
          },
          field: 'messages',
        }],
      }],
    }

    const event = parseWebhook(body)
    expect(event.type).toBe('message')
    expect(event.data.message_type).toBe('image')
    expect(event.data.content.caption).toBe('Look at this')
  })

  it('handles BSUID sender', () => {
    const body = {
      object: 'whatsapp_business_account',
      entry: [{
        changes: [{
          value: {
            metadata: { phone_number_id: 'phone_123' },
            contacts: [{ profile: { name: 'BSUID User' }, wa_id: 'user_abc_123' }],
            messages: [{
              id: 'msg_003',
              from: 'user_abc_123',
              timestamp: '1710000000',
              type: 'text',
              text: { body: 'Hello from BSUID' },
            }],
          },
          field: 'messages',
        }],
      }],
    }

    const event = parseWebhook(body)
    expect(event.type).toBe('message')
    expect(event.data.sender.type).toBe('bsuid')
    expect(event.data.sender.value).toBe('user_abc_123')
  })
})
