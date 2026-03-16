// Thin fetch wrapper for talking to our backend.
// All functions return { ok, data } or { ok: false, error }.
// Token is read from localStorage automatically.

const API_BASE = '/api'

const getToken = () => localStorage.getItem('wa_token')

const request = async (path, options = {}) => {
  const token = getToken()
  const headers = { 'Content-Type': 'application/json', ...options.headers }

  if (token) {
    headers.Authorization = `Bearer ${token}`
  }

  try {
    const res = await fetch(`${API_BASE}${path}`, { ...options, headers })
    const body = await res.json().catch(() => null)

    if (!res.ok) {
      return { ok: false, error: body?.error || `HTTP ${res.status}` }
    }

    return { ok: true, data: body }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

// --- Auth ---

const register = (email, password, name) =>
  request('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  })

const login = (email, password) =>
  request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })

const getMe = () => request('/auth/me')

// --- Accounts ---

const getAccounts = () => request('/accounts')

const connectAccount = (data) =>
  request('/accounts/connect', {
    method: 'POST',
    body: JSON.stringify(data),
  })

const embeddedSignupCallback = (code, phoneNumberId, wabaId) =>
  request('/accounts/callback', {
    method: 'POST',
    body: JSON.stringify({ code, phone_number_id: phoneNumberId, waba_id: wabaId }),
  })

const getAccountStatus = (accountId) =>
  request(`/accounts/${accountId}/status`)

// --- Conversations ---

const getConversations = (accountId) =>
  request(`/accounts/${accountId}/conversations`)

const getMessages = (accountId, contactId, limit = 50) =>
  request(`/accounts/${accountId}/conversations/${contactId}?limit=${limit}`)

// --- Messages ---

const sendMessage = (accountId, to, text) =>
  request(`/accounts/${accountId}/messages/send`, {
    method: 'POST',
    body: JSON.stringify({ to, text }),
  })

const sendTemplate = (accountId, to, templateName, languageCode, components) =>
  request(`/accounts/${accountId}/messages/send-template`, {
    method: 'POST',
    body: JSON.stringify({
      to,
      template_name: templateName,
      language_code: languageCode,
      components,
    }),
  })

// --- Templates ---

const getTemplates = (accountId) =>
  request(`/accounts/${accountId}/templates`)

export {
  register,
  login,
  getMe,
  getAccounts,
  connectAccount,
  embeddedSignupCallback,
  getAccountStatus,
  getConversations,
  getMessages,
  sendMessage,
  sendTemplate,
  getTemplates,
}
