import { describe, it, expect, vi } from 'vitest'
import { createPersistMessageHandler } from '../../../src/services/persistence/persist-message.js'
import { textMessage, imageMessage, statusUpdate } from '../../bus/fixtures/meta-webhook-samples.js'
import { buildEnvelope } from '../../../src/bus/build-envelope.js'

// Build a minimal envelope wrapping a raw body
const makeEnvelope = (rawBody) => {
  const transport = { method: 'webhook', protocol: 'https', headers: {} }
  const context = {
    tenant: 'acme',
    accountid: 'acc123',
    producer: 'coexistance',
    traceid: 'trace-001',
    correlationId: 'corr-001',
    causationId: null,
    source: '/services/coexistance/ingress/meta/whatsapp',
    type: 'io.yoizen.messaging.ingress.received.v1',
    channel: 'whatsapp',
    provider: 'meta',
    domain: 'messaging',
  }
  const result = buildEnvelope(rawBody, transport, context)
  if (!result.ok) throw new Error('envelope build failed: ' + result.error)
  return result.data
}

// Real ObjectId-like string for mocking (valid 24-char hex)
const MOCK_ACCOUNT_ID = '507f1f77bcf86cd799439011'
const MOCK_CONTACT_ID = '507f1f77bcf86cd799439012'

// Build a mock db that simulates finding a matching account
const buildMockDb = (overrides = {}) => {
  const account = {
    _id: MOCK_ACCOUNT_ID,
    business_name: 'Test Business',
    phone_number_id: 'phone_001',
    ...overrides.account,
  }

  const mockContact = { _id: MOCK_CONTACT_ID, wa_id: '5215512345678' }
  const mockMessage = { _id: 'obj_msg_001' }

  const accountsCollection = {
    findOne: vi.fn().mockResolvedValue(account),
  }
  const contactsCollection = {
    findOneAndUpdate: vi.fn().mockResolvedValue(mockContact),
  }
  const messagesCollection = {
    insertOne: vi.fn().mockResolvedValue({ insertedId: 'obj_msg_001' }),
    findOneAndUpdate: vi.fn().mockResolvedValue(mockMessage),
  }

  const collectionSpy = vi.fn().mockImplementation((name) => {
    if (name === 'accounts') return accountsCollection
    if (name === 'contacts') return contactsCollection
    if (name === 'messages') return messagesCollection
    return {}
  })

  return {
    collection: collectionSpy,
    _mockContact: mockContact,
    _mockMessage: mockMessage,
    _account: account,
  }
}

describe('createPersistMessageHandler', () => {
  it('returns a function', () => {
    const handler = createPersistMessageHandler({})
    expect(typeof handler).toBe('function')
  })

  it('calls findOne for message events to look up account', async () => {
    const db = buildMockDb()
    const handler = createPersistMessageHandler(db)
    const envelope = makeEnvelope(textMessage)

    await handler(envelope)

    // collection('accounts').findOne should be called
    expect(db.collection).toHaveBeenCalledWith('accounts')
  })

  it('calls upsertContact for message events', async () => {
    const db = buildMockDb()
    const handler = createPersistMessageHandler(db)
    const envelope = makeEnvelope(textMessage)

    await handler(envelope)

    // contacts collection used for upsert
    expect(db.collection).toHaveBeenCalledWith('contacts')
  })

  it('calls saveMessage for message events', async () => {
    const db = buildMockDb()
    const handler = createPersistMessageHandler(db)
    const envelope = makeEnvelope(textMessage)

    await handler(envelope)

    // messages collection used for insert
    expect(db.collection).toHaveBeenCalledWith('messages')
  })

  it('calls updateMessageStatus for status events', async () => {
    const db = buildMockDb()
    const handler = createPersistMessageHandler(db)
    const envelope = makeEnvelope(statusUpdate)

    await handler(envelope)

    // messages collection used for status update
    expect(db.collection).toHaveBeenCalledWith('messages')
  })

  it('skips and logs when account not found', async () => {
    const db = {
      collection: vi.fn().mockReturnValue({
        findOne: vi.fn().mockResolvedValue(null),
        findOneAndUpdate: vi.fn(),
        insertOne: vi.fn(),
      }),
    }
    const handler = createPersistMessageHandler(db)
    const envelope = makeEnvelope(textMessage)

    // Should not throw
    await expect(handler(envelope)).resolves.toBeUndefined()
  })

  it('skips when envelope has no data.payload', async () => {
    const db = buildMockDb()
    const handler = createPersistMessageHandler(db)

    await handler({ id: 'bad-envelope', data: {} })

    // Should not call any db methods
    expect(db.collection).not.toHaveBeenCalled()
  })

  it('works with imageMessage sample', async () => {
    const db = buildMockDb()
    const handler = createPersistMessageHandler(db)
    const envelope = makeEnvelope(imageMessage)

    await expect(handler(envelope)).resolves.toBeUndefined()
    expect(db.collection).toHaveBeenCalledWith('messages')
  })
})
