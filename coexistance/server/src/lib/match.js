// Declarative pattern matching for message routing.
// Ported from the Jasper's Market MCP helpers — proven pattern.
//
// Usage:
//   const handler = match({
//     'starts:hi':        handleGreeting,
//     'contains:hours':   handleHours,
//     'type:image':       handleImage,
//     'regex:/\\d{5}/':   handleZip,
//     'default':          handleUnknown,
//   })
//   await handler(normalizedMessage)
//
// All text matching is case-insensitive.

const testPattern = (pattern, message) => {
  const text = (message.content?.text || '').toLowerCase()

  if (pattern.startsWith('starts:')) {
    return text.startsWith(pattern.slice(7).toLowerCase())
  }
  if (pattern.startsWith('ends:')) {
    return text.endsWith(pattern.slice(5).toLowerCase())
  }
  if (pattern.startsWith('contains:')) {
    return text.includes(pattern.slice(9).toLowerCase())
  }
  if (pattern.startsWith('equals:')) {
    return text === pattern.slice(7).toLowerCase()
  }
  if (pattern.startsWith('type:')) {
    return message.type === pattern.slice(5)
  }
  if (pattern.startsWith('regex:')) {
    const regex = new RegExp(pattern.slice(6).replace(/^\/|\/$/g, ''), 'i')
    return regex.test(text)
  }
  return false
}

const match = (patterns) => (message) => {
  for (const [pattern, handler] of Object.entries(patterns)) {
    if (pattern === 'default') continue
    if (testPattern(pattern, message)) {
      return handler(message)
    }
  }
  return patterns.default?.(message)
}

export { match, testPattern }
