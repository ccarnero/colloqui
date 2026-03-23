import { describe, it, expect } from 'vitest'
import { filterHeaders } from '../../src/bus/filter-headers.js'

describe('filterHeaders', () => {
  it('passes allowed headers through', () => {
    const headers = {
      'content-type': 'application/json',
      'x-hub-signature-256': 'sha256=abc',
    }
    const result = filterHeaders(headers)
    expect(result['content-type']).toBe('application/json')
    expect(result['x-hub-signature-256']).toBe('sha256=abc')
  })

  it('drops headers not in the allowlist', () => {
    const headers = {
      'content-type': 'application/json',
      'x-custom-header': 'should be dropped',
      'authorization': 'Bearer token',
    }
    const result = filterHeaders(headers)
    expect(result['x-custom-header']).toBeUndefined()
    expect(result['authorization']).toBeUndefined()
    expect(result['content-type']).toBe('application/json')
  })

  it('normalizes uppercase keys to lowercase', () => {
    const headers = {
      'Content-Type': 'application/json',
      'X-Hub-Signature-256': 'sha256=xyz',
      'User-Agent': 'Meta-Webhook/1.0',
    }
    const result = filterHeaders(headers)
    expect(result['content-type']).toBe('application/json')
    expect(result['x-hub-signature-256']).toBe('sha256=xyz')
    expect(result['user-agent']).toBe('Meta-Webhook/1.0')
  })

  it('respects a custom allowlist', () => {
    const headers = {
      'content-type': 'application/json',
      'x-custom': 'value',
      'x-other': 'other',
    }
    const result = filterHeaders(headers, ['x-custom'])
    expect(result['x-custom']).toBe('value')
    expect(result['content-type']).toBeUndefined()
    expect(result['x-other']).toBeUndefined()
  })

  it('returns empty object when no headers match', () => {
    const headers = { 'x-totally-unknown': 'foo' }
    const result = filterHeaders(headers)
    expect(Object.keys(result)).toHaveLength(0)
  })

  it('returns a new object — does not mutate input', () => {
    const headers = { 'content-type': 'application/json' }
    const result = filterHeaders(headers)
    result['content-type'] = 'text/plain'
    expect(headers['content-type']).toBe('application/json')
  })
})
