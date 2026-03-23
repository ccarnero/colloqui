import { describe, it, expect } from 'vitest'
import { ok, err, tryCatch } from '../src/lib/result.js'

describe('Result types', () => {
  it('ok wraps data correctly', () => {
    const result = ok({ name: 'test' })
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ name: 'test' })
  })

  it('err wraps error correctly', () => {
    const result = err('something went wrong')
    expect(result.ok).toBe(false)
    expect(result.error).toBe('something went wrong')
  })

  it('tryCatch wraps successful async fn', async () => {
    const fn = tryCatch(async (x) => x * 2)
    const result = await fn(5)
    expect(result.ok).toBe(true)
    expect(result.data).toBe(10)
  })

  it('tryCatch wraps throwing async fn', async () => {
    const fn = tryCatch(async () => {
      throw new Error('boom')
    })
    const result = await fn()
    expect(result.ok).toBe(false)
    expect(result.error).toBe('boom')
  })
})
