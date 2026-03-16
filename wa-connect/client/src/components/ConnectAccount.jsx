// Connect Account — two modes:
//   1. Sandbox/Dev: manual form to enter credentials
//   2. Embedded Signup: launches Meta's FB.login flow (production)
//
// For MVP, both are available. The user picks which one.

import { useState } from 'react'
import * as api from '../lib/api.js'

const ConnectAccount = ({ onConnected, onCancel }) => {
  const [mode, setMode] = useState(null) // 'sandbox' | 'embedded'

  if (!mode) {
    return (
      <div className="bg-white rounded-lg shadow p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold mb-4">Connect WhatsApp Account</h2>
        <p className="text-sm text-gray-500 mb-6">Choose how you want to connect:</p>

        <div className="space-y-3">
          <button
            onClick={() => setMode('sandbox')}
            className="w-full text-left border border-gray-200 rounded-lg p-4 hover:border-green-500 transition-colors"
          >
            <h3 className="text-sm font-medium">Sandbox / Manual</h3>
            <p className="text-xs text-gray-400 mt-1">
              Enter your WABA ID, phone number ID, and access token manually.
              Good for development and testing.
            </p>
          </button>

          <button
            onClick={() => setMode('embedded')}
            className="w-full text-left border border-gray-200 rounded-lg p-4 hover:border-green-500 transition-colors"
          >
            <h3 className="text-sm font-medium">Embedded Signup</h3>
            <p className="text-xs text-gray-400 mt-1">
              Use Meta's guided flow to connect your business WhatsApp number.
              Recommended for production.
            </p>
          </button>
        </div>

        <button
          onClick={onCancel}
          className="mt-4 w-full text-sm text-gray-400 hover:text-gray-600"
        >
          Cancel
        </button>
      </div>
    )
  }

  if (mode === 'sandbox') {
    return <SandboxForm onConnected={onConnected} onBack={() => setMode(null)} />
  }

  return <EmbeddedSignupFlow onConnected={onConnected} onBack={() => setMode(null)} />
}

// --- Sandbox/Manual Form ---

const SandboxForm = ({ onConnected, onBack }) => {
  const [wabaId, setWabaId] = useState('')
  const [phoneNumberId, setPhoneNumberId] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [displayPhone, setDisplayPhone] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    const result = await api.connectAccount({
      waba_id: wabaId,
      phone_number_id: phoneNumberId,
      access_token: accessToken,
      display_phone: displayPhone || null,
      business_name: businessName || null,
    })

    if (result.ok) {
      onConnected(result.data.account)
    } else {
      setError(typeof result.error === 'string' ? result.error : 'Connection failed')
    }

    setSubmitting(false)
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 w-full max-w-md">
      <h2 className="text-lg font-semibold mb-4">Sandbox / Manual Connect</h2>

      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <div className="bg-red-50 text-red-700 text-sm rounded p-3">{error}</div>}

        <Field label="WABA ID *" value={wabaId} onChange={setWabaId} placeholder="e.g. 123456789" required />
        <Field label="Phone Number ID *" value={phoneNumberId} onChange={setPhoneNumberId} placeholder="e.g. 987654321" required />
        <Field label="Access Token *" value={accessToken} onChange={setAccessToken} placeholder="Your Meta access token" required />
        <Field label="Display Phone" value={displayPhone} onChange={setDisplayPhone} placeholder="+1 555-0123 (optional)" />
        <Field label="Business Name" value={businessName} onChange={setBusinessName} placeholder="My Business (optional)" />

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onBack}
            className="flex-1 border border-gray-300 text-gray-600 rounded-md py-2 text-sm hover:bg-gray-50"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="flex-1 bg-green-600 text-white rounded-md py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50"
          >
            {submitting ? 'Connecting...' : 'Connect'}
          </button>
        </div>
      </form>
    </div>
  )
}

// --- Embedded Signup ---

const EmbeddedSignupFlow = ({ onConnected, onBack }) => {
  const [status, setStatus] = useState('idle') // idle | loading | success | error
  const [error, setError] = useState(null)

  const launchSignup = () => {
    if (typeof window.FB === 'undefined') {
      setError('Facebook SDK not loaded. Check that META_APP_ID and META_CONFIG_ID are set.')
      return
    }

    setStatus('loading')

    // Session info listener — Meta sends waba_id + phone_number_id via postMessage
    let sessionData = {}

    const listener = (event) => {
      if (event.origin !== 'https://www.facebook.com') return
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'WA_EMBEDDED_SIGNUP' && data.event === 'FINISH') {
          sessionData = data.data
        }
      } catch {
        // ignore non-JSON messages
      }
    }

    window.addEventListener('message', listener)

    window.FB.login(
      async (response) => {
        window.removeEventListener('message', listener)

        if (!response.authResponse) {
          setStatus('error')
          setError('Login cancelled or not authorized')
          return
        }

        const code = response.authResponse.code
        const phoneNumberId = sessionData.phone_number_id || null
        const wabaId = sessionData.waba_id || null

        if (!wabaId) {
          setStatus('error')
          setError('Could not get WABA ID from signup flow')
          return
        }

        // Send to our backend
        const result = await api.embeddedSignupCallback(code, phoneNumberId, wabaId)

        if (result.ok) {
          setStatus('success')
          onConnected(result.data.account)
        } else {
          setStatus('error')
          setError(typeof result.error === 'string' ? result.error : 'Connection failed')
        }
      },
      {
        config_id: window.__WA_CONFIG_ID || '',
        response_type: 'code',
        override_default_response_type: true,
        extras: { sessionInfoVersion: 2 },
      }
    )
  }

  return (
    <div className="bg-white rounded-lg shadow p-6 w-full max-w-md text-center">
      <h2 className="text-lg font-semibold mb-4">Embedded Signup</h2>

      {error && <div className="bg-red-50 text-red-700 text-sm rounded p-3 mb-4">{error}</div>}

      {status === 'loading' && (
        <p className="text-sm text-gray-500 mb-4">Completing signup flow...</p>
      )}

      {status === 'success' && (
        <p className="text-sm text-green-600 mb-4">Account connected successfully!</p>
      )}

      {(status === 'idle' || status === 'error') && (
        <>
          <p className="text-sm text-gray-500 mb-6">
            Click the button below to launch Meta's WhatsApp Business signup flow.
          </p>
          <button
            onClick={launchSignup}
            className="bg-blue-600 text-white px-6 py-2 rounded-md font-medium hover:bg-blue-700 transition-colors mb-4"
          >
            Login with Facebook
          </button>
        </>
      )}

      <div>
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          Back
        </button>
      </div>
    </div>
  )
}

// --- Shared ---

const Field = ({ label, value, onChange, placeholder, required }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      required={required}
      className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
    />
  </div>
)

export { ConnectAccount }
