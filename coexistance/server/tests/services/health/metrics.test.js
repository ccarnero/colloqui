import { describe, it, expect, beforeEach } from 'vitest'
import { createBusMetrics } from '../../../src/services/health/metrics.js'

describe('createBusMetrics', () => {
  let metrics

  beforeEach(() => {
    metrics = createBusMetrics()
  })

  it('returns increment, observe, snapshot, reset functions', () => {
    expect(typeof metrics.increment).toBe('function')
    expect(typeof metrics.observe).toBe('function')
    expect(typeof metrics.snapshot).toBe('function')
    expect(typeof metrics.reset).toBe('function')
  })

  describe('increment', () => {
    it('increments a counter by 1 each call', () => {
      metrics.increment('ingress.received', { tenant: 'acme' })
      metrics.increment('ingress.received', { tenant: 'acme' })
      const snap = metrics.snapshot()
      const key = 'ingress.received|{"tenant":"acme"}'
      expect(snap.counters[key]).toBe(2)
    })

    it('tracks different tag combinations as separate counters', () => {
      metrics.increment('ingress.received', { tenant: 'acme' })
      metrics.increment('ingress.received', { tenant: 'beta' })
      const snap = metrics.snapshot()
      const keyAcme = 'ingress.received|{"tenant":"acme"}'
      const keyBeta = 'ingress.received|{"tenant":"beta"}'
      expect(snap.counters[keyAcme]).toBe(1)
      expect(snap.counters[keyBeta]).toBe(1)
    })

    it('works with no tags', () => {
      metrics.increment('my.counter')
      const snap = metrics.snapshot()
      const key = 'my.counter|{}'
      expect(snap.counters[key]).toBe(1)
    })
  })

  describe('observe', () => {
    it('records histogram values', () => {
      metrics.observe('ingress.latency_ms', 100, { tenant: 'acme' })
      metrics.observe('ingress.latency_ms', 200, { tenant: 'acme' })
      metrics.observe('ingress.latency_ms', 50, { tenant: 'acme' })
      const snap = metrics.snapshot()
      const key = 'ingress.latency_ms|{"tenant":"acme"}'
      expect(snap.histograms[key].count).toBe(3)
      expect(snap.histograms[key].min).toBe(50)
      expect(snap.histograms[key].max).toBe(200)
      expect(snap.histograms[key].avg).toBe(350 / 3)
    })

    it('computes p95 correctly', () => {
      // 20 values: 1-20
      for (let i = 1; i <= 20; i++) {
        metrics.observe('latency', i)
      }
      const snap = metrics.snapshot()
      const key = 'latency|{}'
      // p95 of 20 values: index ceil(20*0.95)-1 = ceil(19)-1 = 18 → value 19
      expect(snap.histograms[key].p95).toBe(19)
    })

    it('computes p95 for single value', () => {
      metrics.observe('latency', 42)
      const snap = metrics.snapshot()
      const key = 'latency|{}'
      expect(snap.histograms[key].p95).toBe(42)
    })
  })

  describe('snapshot', () => {
    it('returns empty counters and histograms initially', () => {
      const snap = metrics.snapshot()
      expect(Object.keys(snap.counters)).toHaveLength(0)
      expect(Object.keys(snap.histograms)).toHaveLength(0)
    })

    it('is safe to call multiple times', () => {
      metrics.increment('foo')
      const s1 = metrics.snapshot()
      const s2 = metrics.snapshot()
      expect(s1).toEqual(s2)
    })
  })

  describe('reset', () => {
    it('clears all counters and histograms', () => {
      metrics.increment('foo')
      metrics.observe('bar', 1)
      metrics.reset()
      const snap = metrics.snapshot()
      expect(Object.keys(snap.counters)).toHaveLength(0)
      expect(Object.keys(snap.histograms)).toHaveLength(0)
    })
  })
})
