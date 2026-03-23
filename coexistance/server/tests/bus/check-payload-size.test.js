import { describe, it, expect } from 'vitest'
import { checkPayloadSize } from '../../src/bus/check-payload-size.js'

const buildBody = (sizeKb) => {
  // Build an object whose JSON is approximately sizeKb kilobytes
  const value = 'x'.repeat(sizeKb * 1024)
  return { data: value }
}

describe('checkPayloadSize', () => {
  it('marks small payload (1KB) as inline', () => {
    const result = checkPayloadSize(buildBody(1))
    expect(result.inline).toBe(true)
    expect(result.bytes).toBeGreaterThan(0)
    expect(result.bytes).toBeLessThan(262144)
  })

  it('marks large payload (300KB) as not inline', () => {
    const result = checkPayloadSize(buildBody(300))
    expect(result.inline).toBe(false)
    expect(result.bytes).toBeGreaterThan(262144)
  })

  it('returns correct bytes count', () => {
    const body = { message: 'hello' }
    const result = checkPayloadSize(body)
    const expected = Buffer.byteLength(JSON.stringify(body))
    expect(result.bytes).toBe(expected)
  })

  it('respects custom threshold', () => {
    const body = { data: 'x'.repeat(100) }
    const bytes = Buffer.byteLength(JSON.stringify(body))
    // Set threshold just above the actual size → inline
    expect(checkPayloadSize(body, bytes + 1).inline).toBe(true)
    // Set threshold just below the actual size → not inline
    expect(checkPayloadSize(body, bytes - 1).inline).toBe(false)
  })

  it('body exactly at threshold is inline', () => {
    const body = { data: 'x'.repeat(100) }
    const bytes = Buffer.byteLength(JSON.stringify(body))
    expect(checkPayloadSize(body, bytes).inline).toBe(true)
  })
})
