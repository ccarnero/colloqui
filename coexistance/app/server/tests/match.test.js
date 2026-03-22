import { describe, it, expect } from 'vitest'
import { match } from '../src/lib/match.js'

// match takes an object { pattern: handler } and returns a function that takes a message object
// Message shape: { type, content: { text } }

describe('match', () => {
  it('matches exact text', () => {
    const handler = match({
      'equals:Hello': () => 'found',
      'default': () => 'not found',
    })
    const result = handler({ type: 'text', content: { text: 'Hello' } })
    expect(result).toBe('found')
  })

  it('matches starts: pattern', () => {
    const handler = match({
      'starts:Hello': () => 'starts',
      'default': () => 'nope',
    })
    const result = handler({ type: 'text', content: { text: 'Hello World' } })
    expect(result).toBe('starts')
  })

  it('matches contains: pattern', () => {
    const handler = match({
      'contains:pizza': () => 'pizza!',
      'default': () => 'nope',
    })
    const result = handler({ type: 'text', content: { text: 'I love pizza' } })
    expect(result).toBe('pizza!')
  })

  it('falls through to default', () => {
    const handler = match({
      'equals:something': () => 'nope',
      'default': () => 'default',
    })
    const result = handler({ type: 'text', content: { text: 'random text' } })
    expect(result).toBe('default')
  })

  it('is case insensitive', () => {
    const handler = match({
      'equals:hello': () => 'found',
      'default': () => 'nope',
    })
    const result = handler({ type: 'text', content: { text: 'HELLO' } })
    expect(result).toBe('found')
  })

  it('matches type: pattern', () => {
    const handler = match({
      'type:image': () => 'image!',
      'default': () => 'nope',
    })
    const result = handler({ type: 'image', content: {} })
    expect(result).toBe('image!')
  })
})
