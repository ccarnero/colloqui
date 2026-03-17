// Account settings page — token management and connection status.
// Accessible design: status uses shape + icon + text, not just color.
// Shapes: circle (ok), triangle (warning), x-square (error).

import { useState, useEffect } from 'react'
import { CheckCircle, AlertTriangle, XOctagon, RefreshCw, ArrowLeft, Key, Info } from 'lucide-react'
import * as api from '../lib/api.js'

// Status config — shape + icon + label + style, accessible without color perception
const STATUS_MAP = {
  connected: {
    Icon: CheckCircle,
    label: 'Conectado',
    description: 'El token es válido y la cuenta está activa.',
    bg: 'bg-teal-50',
    border: 'border-teal-200',
    text: 'text-teal-700',
    iconColor: 'text-teal-600',
  },
  unknown: {
    Icon: CheckCircle,
    label: 'Conectado',
    description: 'Token activo. No se pudo determinar la fecha de expiración — puede ser un System User token permanente.',
    bg: 'bg-teal-50',
    border: 'border-teal-200',
    text: 'text-teal-700',
    iconColor: 'text-teal-600',
  },
  expiring_soon: {
    Icon: AlertTriangle,
    label: 'Vence pronto',
    description: 'El token vence en menos de 7 días. Renovalo para mantener la conexión.',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    text: 'text-amber-700',
    iconColor: 'text-amber-600',
  },
  expired: {
    Icon: XOctagon,
    label: 'Desconectado',
    description: 'El token expiró. Pegá un nuevo token desde el panel de Meta para reconectar.',
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    iconColor: 'text-red-600',
  },
  no_token: {
    Icon: XOctagon,
    label: 'Sin token',
    description: 'No hay token configurado. Pegá un token desde el panel de Meta.',
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    iconColor: 'text-red-600',
  },
}

const AccountSettingsPage = ({ account, onBack }) => {
  const [tokenStatus, setTokenStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [newToken, setNewToken] = useState('')
  const [updating, setUpdating] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'ok' | 'error', text }

  useEffect(() => {
    if (!account?._id) return
    loadTokenStatus()
  }, [account?._id])

  const loadTokenStatus = async () => {
    setLoading(true)
    const result = await api.getTokenStatus(account._id)
    if (result.ok) {
      setTokenStatus(result.data)
    } else {
      setMessage({ type: 'error', text: `Error al consultar estado: ${result.error}` })
    }
    setLoading(false)
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    setMessage(null)
    const result = await api.refreshAccountToken(account._id)
    if (result.ok) {
      setMessage({ type: 'ok', text: `Token renovado. Vence en ${result.data.days_remaining} días.` })
      await loadTokenStatus()
    } else {
      setMessage({ type: 'error', text: `Error al renovar: ${result.error}` })
    }
    setRefreshing(false)
  }

  const handleUpdate = async (e) => {
    e.preventDefault()
    if (!newToken.trim()) return
    setUpdating(true)
    setMessage(null)
    const result = await api.updateAccountToken(account._id, newToken.trim())
    if (result.ok) {
      const msg = result.data.exchanged
        ? `Token activado y extendido a ${result.data.days_remaining} días.`
        : `Token guardado (corta duración — ${result.data.days_remaining} días). Intentá renovar para extenderlo.`
      setMessage({ type: 'ok', text: msg })
      setNewToken('')
      await loadTokenStatus()
    } else {
      setMessage({ type: 'error', text: `Error al actualizar: ${result.error}` })
    }
    setUpdating(false)
  }

  const status = tokenStatus?.status || 'no_token'
  const config = STATUS_MAP[status] || STATUS_MAP.no_token
  const { Icon } = config

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto">
        {/* Back button */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6 transition-colors"
        >
          <ArrowLeft size={16} />
          Volver al dashboard
        </button>

        <h1 className="text-xl font-bold text-gray-900 mb-6">Ajustes de cuenta</h1>

        {loading ? (
          <div className="text-gray-400 text-sm">Cargando...</div>
        ) : (
          <>
            {/* Connection status card */}
            <div className={`rounded-lg border ${config.border} ${config.bg} p-5 mb-6`}>
              <div className="flex items-start gap-3">
                <Icon size={24} className={`${config.iconColor} shrink-0 mt-0.5`} />
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`font-semibold ${config.text}`}>{config.label}</span>
                    {tokenStatus?.days_remaining != null && (
                      <span className="text-xs text-gray-500">
                        — {tokenStatus.days_remaining} días restantes
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-600">{config.description}</p>
                  {tokenStatus?.expires_at && (
                    <p className="text-xs text-gray-400 mt-2">
                      Expira: {new Date(tokenStatus.expires_at).toLocaleDateString('es-AR', {
                        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  )}
                  {tokenStatus?.token_refreshed_at && (
                    <p className="text-xs text-gray-400">
                      Última renovación: {new Date(tokenStatus.token_refreshed_at).toLocaleDateString('es-AR', {
                        day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  )}
                </div>
              </div>

              {/* Refresh button — only when there's a valid token to refresh */}
              {(status === 'connected' || status === 'expiring_soon' || status === 'unknown') && (
                <button
                  onClick={handleRefresh}
                  disabled={refreshing}
                  className="mt-4 flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition-colors"
                >
                  <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
                  {refreshing ? 'Renovando...' : 'Renovar token'}
                </button>
              )}
            </div>

            {/* Manual token input — always visible so the user can paste a new one */}
            <div className="rounded-lg border border-gray-200 bg-white p-5 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Key size={16} className="text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-700">Ingresar token manualmente</h2>
              </div>
              <p className="text-xs text-gray-500 mb-4">
                Pegá un token temporal desde el{' '}
                <a
                  href="https://developers.facebook.com/apps/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-600 underline"
                >
                  Meta App Dashboard
                </a>
                {' '}→ WhatsApp → API Setup. Se intentará extender automáticamente a ~60 días.
              </p>
              <form onSubmit={handleUpdate} className="flex gap-2">
                <input
                  type="text"
                  value={newToken}
                  onChange={(e) => setNewToken(e.target.value)}
                  placeholder="EAAG..."
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent font-mono"
                />
                <button
                  type="submit"
                  disabled={updating || !newToken.trim()}
                  className="px-4 py-2 bg-teal-600 text-white rounded-md text-sm font-medium hover:bg-teal-700 disabled:opacity-50 transition-colors"
                >
                  {updating ? 'Activando...' : 'Activar'}
                </button>
              </form>
            </div>

            {/* Account info — read-only reference */}
            <div className="rounded-lg border border-gray-200 bg-white p-5 mb-6">
              <div className="flex items-center gap-2 mb-3">
                <Info size={16} className="text-gray-400" />
                <h2 className="text-sm font-semibold text-gray-700">Información de la cuenta</h2>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-gray-400">Nombre</dt>
                <dd className="text-gray-700 font-mono">{tokenStatus?.business_name || '—'}</dd>
                <dt className="text-gray-400">Teléfono</dt>
                <dd className="text-gray-700 font-mono">{tokenStatus?.display_phone || '—'}</dd>
                <dt className="text-gray-400">WABA ID</dt>
                <dd className="text-gray-700 font-mono text-xs">{tokenStatus?.waba_id || '—'}</dd>
                <dt className="text-gray-400">Phone Number ID</dt>
                <dd className="text-gray-700 font-mono text-xs">{tokenStatus?.phone_number_id || '—'}</dd>
              </dl>
            </div>

            {/* Feedback message */}
            {message && (
              <div
                className={`rounded-md p-3 text-sm ${
                  message.type === 'ok'
                    ? 'bg-teal-50 text-teal-700 border border-teal-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {message.text}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export { AccountSettingsPage }
