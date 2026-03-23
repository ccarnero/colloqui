import { describe, it, expect } from 'vitest'
import { buildSubject } from '../../src/bus/build-subject.js'

const validParams = () => ({
  tenant: 'acme',
  producer: 'coexistance',
  domain: 'messaging',
  channel: 'whatsapp',
  provider: 'meta',
  kind: 'received',
  version: 1,
})

describe('buildSubject', () => {
  it('builds a valid subject with explicit version', () => {
    const result = buildSubject(validParams())
    expect(result.ok).toBe(true)
    expect(result.data).toBe('evt.acme.coexistance.messaging.whatsapp.meta.received.v1')
  })

  it('uses version 1 as default when not provided', () => {
    const { version, ...params } = validParams()
    const result = buildSubject(params)
    expect(result.ok).toBe(true)
    expect(result.data).toContain('.v1')
  })

  it('rejects field containing a dot — tenant', () => {
    const result = buildSubject({ ...validParams(), tenant: 'ac.me' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('tenant')
    expect(result.error).toContain('dot')
  })

  it('rejects field containing a dot — domain', () => {
    const result = buildSubject({ ...validParams(), domain: 'mess.aging' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('domain')
  })

  it('rejects empty tenant', () => {
    const result = buildSubject({ ...validParams(), tenant: '' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('tenant')
  })

  it('rejects missing kind', () => {
    const { kind, ...params } = validParams()
    const result = buildSubject(params)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('kind')
  })

  it('rejects empty producer', () => {
    const result = buildSubject({ ...validParams(), producer: '' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('producer')
  })

  it('builds correct subject format', () => {
    const result = buildSubject({ ...validParams(), version: 2 })
    expect(result.ok).toBe(true)
    expect(result.data).toBe('evt.acme.coexistance.messaging.whatsapp.meta.received.v2')
  })
})
