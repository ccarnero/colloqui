// Lightweight in-process metrics store — no external dependencies.
// Counters (increment) and histograms (observe) keyed by name + tag combinations.
// snapshot() returns a plain object safe to serialize as JSON.

const createBusMetrics = () => {
  // Map: "name|{tags}" → count
  const counters = new Map()
  // Map: "name|{tags}" → number[]
  const histograms = new Map()

  const tagKey = (name, tags) => `${name}|${JSON.stringify(tags || {})}`

  const increment = (name, tags = {}) => {
    const key = tagKey(name, tags)
    counters.set(key, (counters.get(key) || 0) + 1)
  }

  const observe = (name, value, tags = {}) => {
    const key = tagKey(name, tags)
    if (!histograms.has(key)) histograms.set(key, [])
    histograms.get(key).push(value)
  }

  const snapshot = () => {
    const countersOut = {}
    for (const [key, count] of counters) {
      countersOut[key] = count
    }

    const histogramsOut = {}
    for (const [key, values] of histograms) {
      if (values.length === 0) continue
      const sorted = [...values].sort((a, b) => a - b)
      const sum = sorted.reduce((acc, v) => acc + v, 0)
      const count = sorted.length
      const min = sorted[0]
      const max = sorted[sorted.length - 1]
      const avg = sum / count
      const p95Index = Math.ceil(count * 0.95) - 1
      const p95 = sorted[Math.max(0, p95Index)]
      histogramsOut[key] = { count, min, max, avg, p95 }
    }

    return { counters: countersOut, histograms: histogramsOut }
  }

  const reset = () => {
    counters.clear()
    histograms.clear()
  }

  return { increment, observe, snapshot, reset }
}

export { createBusMetrics }
