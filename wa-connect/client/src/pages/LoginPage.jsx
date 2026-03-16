import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/auth-context.jsx'

const LoginPage = () => {
  const { login } = useAuth()

  // Restore saved credentials if "remember me" was checked
  const saved = JSON.parse(localStorage.getItem('wa_remember') || 'null')
  const [email, setEmail] = useState(saved?.email || '')
  const [password, setPassword] = useState(saved?.password || '')
  const [remember, setRemember] = useState(!!saved)
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)

    // Save or clear remember-me
    if (remember) {
      localStorage.setItem('wa_remember', JSON.stringify({ email, password }))
    } else {
      localStorage.removeItem('wa_remember')
    }

    const result = await login(email, password)

    if (!result.ok) {
      setError(typeof result.error === 'string' ? result.error : result.error?.message || 'Login failed')
    }

    setSubmitting(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-2">WA Connect</h1>
        <p className="text-gray-500 text-center mb-8 text-sm">Sign in to your account</p>

        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow p-6 space-y-4">
          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded p-3">{error}</div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              placeholder="Your password"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={remember}
              onChange={(e) => setRemember(e.target.checked)}
              className="rounded border-gray-300 text-green-600 focus:ring-green-500"
            />
            <span className="text-sm text-gray-600">Recordar sesión</span>
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-green-600 text-white rounded-md py-2 text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {submitting ? 'Signing in...' : 'Sign in'}
          </button>

          <p className="text-center text-sm text-gray-500">
            No account?{' '}
            <Link to="/register" className="text-green-600 hover:underline">
              Register
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}

export { LoginPage }
