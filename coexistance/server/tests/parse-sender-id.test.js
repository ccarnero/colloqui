import { describe, it, expect } from 'vitest'
import { parseSenderId } from '../src/meta/parse-sender-id.js'

describe('parseSenderId', () => {
  it('identifies E.164 phone number', () => {
    const result = parseSenderId('5215512345678')
    expect(result.type).toBe('phone')
    expect(result.value).toBe('5215512345678')
  })

  it('identifies phone number with +', () => {
    const result = parseSenderId('+5215512345678')
    expect(result.type).toBe('phone')
  })

  it('identifies BSUID (alphanumeric)', () => {
    const result = parseSenderId('abc123xyz456')
    expect(result.type).toBe('bsuid')
    expect(result.value).toBe('abc123xyz456')
  })

  it('identifies BSUID with underscores', () => {
    const result = parseSenderId('user_name_123')
    expect(result.type).toBe('bsuid')
  })

  it('trims whitespace', () => {
    const result = parseSenderId('  5215512345678  ')
    expect(result.type).toBe('phone')
    expect(result.value).toBe('5215512345678')
  })

  it('handles empty string as unknown', () => {
    const result = parseSenderId('')
    expect(result.type).toBe('unknown')
  })

  it('normalizes Argentine mobile numbers (removes 9 after 54)', () => {
    const result = parseSenderId('5491134602008')
    expect(result.type).toBe('phone')
    expect(result.value).toBe('541134602008')
    expect(result.normalized).toBe('+541134602008')
  })

  it('does not modify non-Argentine numbers', () => {
    const result = parseSenderId('5215512345678')
    expect(result.type).toBe('phone')
    expect(result.value).toBe('5215512345678')
  })

  it('normalizes Argentine number with + prefix', () => {
    const result = parseSenderId('+5491134602008')
    expect(result.type).toBe('phone')
    expect(result.value).toBe('541134602008')
  })
})
