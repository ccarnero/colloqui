// Main dashboard — shows accounts, conversations, and chat view.
// Layout: [Sidebar | Chat Area]
// v2: multi-account support with AccountSelector + localStorage persistence

import { useState, useEffect, useCallback, useRef } from 'react'
import { CheckCircle, AlertTriangle, XOctagon, Settings } from 'lucide-react'
import { useAuth } from '../context/auth-context.jsx'
import * as api from '../lib/api.js'
import { useWebSocket } from '../lib/use-websocket.js'
import { Sidebar } from '../components/Sidebar.jsx'
import { ChatView } from '../components/ChatView.jsx'
import { ConnectAccount } from '../components/ConnectAccount.jsx'
import { EmptyState } from '../components/EmptyState.jsx'
import { AccountSelector } from '../components/AccountSelector.jsx'
import { AccountSettingsPage } from './AccountSettingsPage.jsx'

// Persist/restore selected account ID across sessions
const ACTIVE_ACCOUNT_KEY = 'coexistance_active_account_id'

const saveActiveAccountId = (id) => {
  try { localStorage.setItem(ACTIVE_ACCOUNT_KEY, id) } catch (_) { /* noop */ }
}

const loadActiveAccountId = () => {
  try { return localStorage.getItem(ACTIVE_ACCOUNT_KEY) } catch (_) { return null }
}

// Pick initial account: saved preference → first in list → null
const pickInitialAccount = (accounts) => {
  if (!accounts || accounts.length === 0) return null
  const savedId = loadActiveAccountId()
  if (savedId) {
    const found = accounts.find((a) => a._id === savedId)
    if (found) return found
  }
  return accounts[0]
}

const DashboardPage = () => {
  const { user, logout } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [activeAccount, setActiveAccount] = useState(null)
  const [conversations, setConversations] = useState([])
  const [activeContact, setActiveContact] = useState(null)
  const [showConnect, setShowConnect] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [tokenStatus, setTokenStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshTick, setRefreshTick] = useState(0)

  // Track active account ID for WS filtering
  const activeAccountIdRef = useRef(null)
  useEffect(() => {
    activeAccountIdRef.current = activeAccount?._id || null
  }, [activeAccount?._id])

  // Load accounts on mount
  useEffect(() => {
    api.getAccounts().then((result) => {
      if (result.ok) {
        const accts = result.data.accounts || []
        setAccounts(accts)
        const initial = pickInitialAccount(accts)
        if (initial) setActiveAccount(initial)
      }
      setLoading(false)
    })
  }, [])

  // Switch account handler — resets UI state + persists choice
  const handleSwitchAccount = useCallback((acct) => {
    if (acct._id === activeAccount?._id) return
    // Reset dependent state before switching
    setActiveContact(null)
    setConversations([])
    setTokenStatus(null)
    setShowSettings(false)
    setRefreshTick(0)
    // Switch
    setActiveAccount(acct)
    saveActiveAccountId(acct._id)
    console.log(`[dashboard] switched to account ${acct._id} (${acct.business_name || acct.display_phone})`)
  }, [activeAccount?._id])

  // Load token status when active account changes
  useEffect(() => {
    if (!activeAccount?._id) {
      setTokenStatus(null)
      return
    }
    api.getTokenStatus(activeAccount._id).then((result) => {
      if (result.ok) setTokenStatus(result.data)
    })
  }, [activeAccount?._id])

  // Load conversations when active account changes
  useEffect(() => {
    if (!activeAccount) {
      setConversations([])
      return
    }

    api.getConversations(activeAccount._id).then((result) => {
      if (result.ok) {
        setConversations(result.data.conversations || [])
      }
    })
  }, [activeAccount])

  const refreshConversations = useCallback(() => {
    if (!activeAccount) return
    api.getConversations(activeAccount._id).then((result) => {
      if (result.ok) {
        setConversations(result.data.conversations || [])
      }
    })
  }, [activeAccount])

  // Real-time updates via WebSocket — only act on messages for the active account
  const handleWsMessage = useCallback((event) => {
    if (event.type === 'new_message' || event.type === 'status_update') {
      const eventAccountId = event.data?.account_id
      const currentAccountId = activeAccountIdRef.current

      // If message is for a different account, ignore (conversations stay clean)
      if (eventAccountId && currentAccountId && eventAccountId !== currentAccountId) {
        console.log(`[ws] ignoring event for account ${eventAccountId} (active: ${currentAccountId})`)
        return
      }

      refreshConversations()
      setRefreshTick((t) => t + 1)
    }
  }, [refreshConversations])

  useWebSocket(handleWsMessage)

  const handleAccountConnected = useCallback((newAccount) => {
    setAccounts((prev) => [...prev, newAccount])
    setActiveAccount(newAccount)
    saveActiveAccountId(newAccount._id)
    setShowConnect(false)
  }, [])

  // Refresh token status when leaving settings page
  const handleBackFromSettings = useCallback(() => {
    setShowSettings(false)
    if (activeAccount?._id) {
      api.getTokenStatus(activeAccount._id).then((result) => {
        if (result.ok) setTokenStatus(result.data)
      })
    }
  }, [activeAccount?._id])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Cargando dashboard...</div>
      </div>
    )
  }

  // No accounts connected yet → show connect prompt
  if (accounts.length === 0 && !showConnect) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header user={user} logout={logout} />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-xl font-semibold mb-2">Bienvenido a Coexistance</h2>
            <p className="text-gray-500 mb-6">Conectá tu cuenta de WhatsApp Business para empezar.</p>
            <button
              onClick={() => setShowConnect(true)}
              className="bg-green-600 text-white px-6 py-2 rounded-md font-medium hover:bg-green-700 transition-colors"
            >
              Conectar WhatsApp
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (showConnect) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header user={user} logout={logout} accounts={accounts} activeAccount={activeAccount} onSwitchAccount={handleSwitchAccount} />
        <div className="flex-1 flex items-center justify-center p-4">
          <ConnectAccount
            onConnected={handleAccountConnected}
            onCancel={() => setShowConnect(false)}
          />
        </div>
      </div>
    )
  }

  // Settings page
  if (showSettings && activeAccount) {
    return (
      <div className="h-screen flex flex-col bg-gray-50">
        <Header
          user={user}
          logout={logout}
          accounts={accounts}
          activeAccount={activeAccount}
          onSwitchAccount={handleSwitchAccount}
          tokenStatus={tokenStatus}
          onConnect={() => setShowConnect(true)}
          onSettings={() => setShowSettings(true)}
        />
        <AccountSettingsPage
          account={activeAccount}
          onBack={handleBackFromSettings}
        />
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header
        user={user}
        logout={logout}
        accounts={accounts}
        activeAccount={activeAccount}
        onSwitchAccount={handleSwitchAccount}
        tokenStatus={tokenStatus}
        onConnect={() => setShowConnect(true)}
        onSettings={() => setShowSettings(true)}
      />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          conversations={conversations}
          activeContact={activeContact}
          onSelectContact={setActiveContact}
          onRefresh={refreshConversations}
          accountName={activeAccount?.business_name || activeAccount?.display_phone}
        />
        {activeContact && activeAccount ? (
          <ChatView
            accountId={activeAccount._id}
            contact={activeContact}
            onMessageSent={refreshConversations}
            refreshTick={refreshTick}
          />
        ) : (
          <EmptyState message="Seleccioná una conversación o esperá mensajes entrantes" account={activeAccount} />
        )}
      </div>
    </div>
  )
}

// --- Header with account selector + token status indicator ---

// Accessible status indicator: shape + icon + text, not just color
const STATUS_INDICATORS = {
  connected: { Icon: CheckCircle, label: 'Conectado', className: 'text-teal-600' },
  unknown: { Icon: CheckCircle, label: 'Conectado', className: 'text-teal-600' },
  expiring_soon: { Icon: AlertTriangle, label: 'Vence pronto', className: 'text-amber-600' },
  expired: { Icon: XOctagon, label: 'Desconectado', className: 'text-red-600' },
  no_token: { Icon: XOctagon, label: 'Sin token', className: 'text-red-600' },
}

const Header = ({ user, logout, accounts, activeAccount, onSwitchAccount, tokenStatus, onConnect, onSettings }) => {
  const status = tokenStatus?.status
  const indicator = status ? STATUS_INDICATORS[status] : null

  return (
    <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold text-green-700">Coexistance</h1>
        {accounts && activeAccount && (
          <AccountSelector
            accounts={accounts}
            activeAccount={activeAccount}
            onSelect={onSwitchAccount}
          />
        )}
        {indicator && (
          <button
            onClick={onSettings}
            className={`flex items-center gap-1.5 text-xs ${indicator.className} hover:opacity-80 transition-opacity`}
            title={`Estado: ${indicator.label}. Click para ver ajustes.`}
          >
            <indicator.Icon size={14} />
            <span>{indicator.label}</span>
            {tokenStatus?.days_remaining != null && status === 'expiring_soon' && (
              <span className="text-gray-400">({tokenStatus.days_remaining}d)</span>
            )}
          </button>
        )}
      </div>
      <div className="flex items-center gap-4">
        {onSettings && activeAccount && (
          <button
            onClick={onSettings}
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title="Ajustes de cuenta"
          >
            <Settings size={18} />
          </button>
        )}
        {onConnect && (
          <button
            onClick={onConnect}
            className="text-sm text-green-600 hover:underline"
          >
            + Agregar cuenta
          </button>
        )}
        <span className="text-sm text-gray-500">{user?.name || user?.email}</span>
        <button
          onClick={logout}
          className="text-sm text-gray-400 hover:text-gray-600"
        >
          Salir
        </button>
      </div>
    </header>
  )
}

export { DashboardPage }
