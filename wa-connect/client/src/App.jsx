// Root app component — handles routing based on auth state.
// No auth → login/register pages.
// Auth'd → dashboard with conversation list + chat.

import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/auth-context.jsx'
import { LoginPage } from './pages/LoginPage.jsx'
import { RegisterPage } from './pages/RegisterPage.jsx'
import { DashboardPage } from './pages/DashboardPage.jsx'

const App = () => {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading...</div>
      </div>
    )
  }

  return (
    <Routes>
      <Route
        path="/login"
        element={user ? <Navigate to="/" /> : <LoginPage />}
      />
      <Route
        path="/register"
        element={user ? <Navigate to="/" /> : <RegisterPage />}
      />
      <Route
        path="/*"
        element={user ? <DashboardPage /> : <Navigate to="/login" />}
      />
    </Routes>
  )
}

export { App }
