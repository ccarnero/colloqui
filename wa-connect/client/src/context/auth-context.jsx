// Auth context — provides user state and login/logout/register functions.
// Token is persisted in localStorage. On mount, tries to restore session.

import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import * as api from '../lib/api.js'

const AuthContext = createContext(null)

const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  // Try to restore session on mount
  useEffect(() => {
    const token = localStorage.getItem('wa_token')
    if (!token) {
      setLoading(false)
      return
    }

    api.getMe().then((result) => {
      if (result.ok) {
        setUser(result.data.user)
      } else {
        localStorage.removeItem('wa_token')
      }
      setLoading(false)
    })
  }, [])

  const loginFn = useCallback(async (email, password) => {
    const result = await api.login(email, password)
    if (result.ok) {
      localStorage.setItem('wa_token', result.data.token)
      setUser(result.data.user)
    }
    return result
  }, [])

  const registerFn = useCallback(async (email, password, name) => {
    const result = await api.register(email, password, name)
    if (result.ok) {
      localStorage.setItem('wa_token', result.data.token)
      setUser(result.data.user)
    }
    return result
  }, [])

  const logout = useCallback(() => {
    localStorage.removeItem('wa_token')
    setUser(null)
  }, [])

  return (
    <AuthContext.Provider value={{ user, loading, login: loginFn, register: registerFn, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export { AuthProvider, useAuth }
