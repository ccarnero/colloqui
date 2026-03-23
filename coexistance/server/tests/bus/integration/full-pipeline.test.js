// Integration test: full pipeline from processIngress → publish → persist-message handler.
// Mocks nc and db. Does NOT mock processIngress, buildEnvelope, validateEnvelope, buildSubject.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { processIngress } from '../../../src/services/ingress/process-ingress.js'
import { createPersistMessageHandler } from '../../../src/services/persistence/persist-message.js'
import { textMessage, statusUpdate, imageMessage } from '../fixtures/meta-webhook-samples.js'
import { StringCodec } from 'nats'

const sc = StringCodec()

const MOCK_ACCOUNT_ID = '507f1f77bcf86cd799439011'
const MOCK_CONTACT_ID = '507f1f77bcf86cd799439012'

// Build a mock NATS connection that captures published messages
const buildCapturingNc = () => {
  const published = []
  return {
    publish: vi.fn().mockImplementation((subject, data, opts) => {
      published.push({ subject, data, opts })
    }),
    _published: published,
  }
}

// Build a mock db with proper per-collection routing
const buildMockDb = () => {
  const account = {
    _id: MOCK_ACCOUNT_ID,
    business_name: 'Test Business',
    phone_number_id: 'phone_001',
  }
  const mockContact = { _id: MOCK_CONTACT_ID, wa_id: '5215512345678' }

  const saveMessageMock = vi.fn().mockResolvedValue({ insertedId: 'msg_001' })
  const upsertContactMock = vi.fn().mockResolvedValue(mockContact)
  const updateStatusMock = vi.fn().mockResolvedValue({ _id: 'msg_001', status: 'delivered' })

  return {
    collection: vi.fn().mockImplementation((name) => {
      if (name === 'accounts') return { findOne: vi.fn().mockResolvedValue(account) }
      if (name === 'contacts') return { findOneAndUpdate: upsertContactMock }
      if (name === 'messages') return {
        insertOne: saveMessageMock,
        findOneAndUpdate: updateStatusMock,
      }
      return {}
    }),
    _saveMessageMock: saveMessageMock,
    _upsertContactMock: upsertContactMock,
    _updateStatusMock: updateStatusMock,
  }
}

const buildRequest = (rawBody) => ({
  rawBody,
  headers: { 'content-type': 'application/json', 'x-request-id': 'req-001' },
  tenant: 'acme',
  accountid: MOCK_ACCOUNT_ID,
  correlationId: 'corr-001',
})

describe('Full pipeline integration: processIngress → persist handler', () => {
  it('processIngress publishes a valid envelope, persist handler saves the message', async () => {
    const nc = buildCapturingNc()
    const db = buildMockDb()

    // Step 1: processIngress
    const ingressResult = await processIngress(buildRequest(textMessage), { nc, producer: 'coexistance' })
    expect(ingressResult.ok).toBe(true)
    expect(nc.publish).toHaveBeenCalledOnce()

    // Step 2: Decode the published envelope
    const [, publishedData] = nc.publish.mock.calls[0]
    const envelope = JSON.parse(sc.decode(publishedData))

    expect(envelope.tenant).toBe('acme')
    expect(envelope.accountid).toBe(MOCK_ACCOUNT_ID)
    expect(envelope.data.payload_inline).toBe(true)
    expect(envelope.data.payload).toEqual(textMessage)

    // Step 3: Feed envelope to persist handler
    const persistHandler = createPersistMessageHandler(db)
    await persistHandler(envelope)

    // Verify saveMessage was called
    expect(db._saveMessageMock).toHaveBeenCalledOnce()
    const savedMsg = db._saveMessageMock.mock.calls[0][0]
    expect(savedMsg.direction).toBe('inbound')
    expect(savedMsg.type).toBe('text')
    expect(savedMsg.status).toBe('received')
  })

  it('status update flows through processIngress → persist handler → updateMessageStatus', async () => {
    const nc = buildCapturingNc()
    const db = buildMockDb()

    const ingressResult = await processIngress(buildRequest(statusUpdate), { nc, producer: 'coexistance' })
    expect(ingressResult.ok).toBe(true)

    const [, publishedData] = nc.publish.mock.calls[0]
    const envelope = JSON.parse(sc.decode(publishedData))

    const persistHandler = createPersistMessageHandler(db)
    await persistHandler(envelope)

    expect(db._updateStatusMock).toHaveBeenCalledOnce()
    const [filter, updateDoc] = db._updateStatusMock.mock.calls[0]
    expect(updateDoc.$set.status).toBe('delivered')
  })

  it('image message flows through correctly', async () => {
    const nc = buildCapturingNc()
    const db = buildMockDb()

    await processIngress(buildRequest(imageMessage), { nc, producer: 'coexistance' })

    const [, publishedData] = nc.publish.mock.calls[0]
    const envelope = JSON.parse(sc.decode(publishedData))

    const persistHandler = createPersistMessageHandler(db)
    await persistHandler(envelope)

    expect(db._saveMessageMock).toHaveBeenCalledOnce()
    const savedMsg = db._saveMessageMock.mock.calls[0][0]
    expect(savedMsg.type).toBe('image')
  })

  it('subject matches expected NATS pattern', async () => {
    const nc = buildCapturingNc()
    await processIngress(buildRequest(textMessage), { nc, producer: 'coexistance' })

    const [subject] = nc.publish.mock.calls[0]
    expect(subject).toMatch(/^evt\.[^.]+\.[^.]+\.[^.]+\.[^.]+\.[^.]+\.[^.]+\.v\d+$/)
    expect(subject).toBe('evt.acme.coexistance.messaging.whatsapp.meta.received.v1')
  })
})
