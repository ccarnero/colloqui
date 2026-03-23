// Determines whether the payload should be inlined or stored by reference.
// Default threshold: 256 KB (262144 bytes).
// Returns { inline: boolean, bytes: number }.

const checkPayloadSize = (rawBody, threshold = 262144) => {
  const bytes = Buffer.byteLength(JSON.stringify(rawBody))
  return { inline: bytes <= threshold, bytes }
}

export { checkPayloadSize }
