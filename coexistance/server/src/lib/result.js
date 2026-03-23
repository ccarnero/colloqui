// Result type — Either-like sin librería externa.
// Toda función que puede fallar retorna ok(data) o err(error).
// El consumidor decide qué hacer con el resultado.

const ok = (data) => ({ ok: true, data })

const err = (error) => ({ ok: false, error })

// Wraps an async function so thrown exceptions become err()
const tryCatch = (fn) => async (...args) => {
  try {
    const data = await fn(...args)
    return ok(data)
  } catch (e) {
    return err(e.message || String(e))
  }
}

export { ok, err, tryCatch }
