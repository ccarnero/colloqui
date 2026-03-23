import { describe, it, expect } from 'vitest'
import { pipe, pipeAsync } from '../src/lib/pipe.js'

describe('pipe', () => {
  it('composes functions left to right', () => {
    const add1 = (x) => x + 1
    const double = (x) => x * 2
    const result = pipe(add1, double)(3)
    expect(result).toBe(8) // (3 + 1) * 2
  })

  it('works with single function', () => {
    const result = pipe((x) => x + 10)(5)
    expect(result).toBe(15)
  })
})

describe('pipeAsync', () => {
  it('composes async functions left to right', async () => {
    const add1 = async (x) => x + 1
    const double = async (x) => x * 2
    const result = await pipeAsync(add1, double)(3)
    expect(result).toBe(8)
  })

  it('handles mix of sync and async', async () => {
    const add1 = (x) => x + 1
    const asyncDouble = async (x) => x * 2
    const result = await pipeAsync(add1, asyncDouble)(3)
    expect(result).toBe(8)
  })
})
