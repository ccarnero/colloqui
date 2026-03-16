// Main dashboard — shows accounts, conversations, and chat view.
// Layout: [Sidebar | Chat Area]
// Sidebar: account selector + conversation list
// Chat Area: message bubbles + input

import { useState, useEffect, useCallback } from 'react'
import { useAuth } from '../context/auth-context.jsx'
import * as api from '../lib/api.js'
import { useWebSocket } from '../lib/use-websocket.js'
import { Sidebar } from '../components/Sidebar.jsx'
import { ChatView } from '../components/ChatView.jsx'
import { ConnectAccount } from '../components/ConnectAccount.jsx'
import { EmptyState } from '../components/EmptyState.jsx'

const DashboardPage = () => {
  const { user, logout } = useAuth()
  const [accounts, setAccounts] = useState([])
  const [activeAccount, setActiveAccount] = useState(null)
  const [conversations, setConversations] = useState([])
  const [activeContact, setActiveContact] = useState(null)
  const [showConnect, setShowConnect] = useState(false)
  const [loading, setLoading] = useState(true)

  // Load accounts on mount
  useEffect(() => {
    api.getAccounts().then((result) => {
      if (result.ok) {
        setAccounts(result.data.accounts || [])
        if (result.data.accounts?.length > 0) {
          setActiveAccount(result.data.accounts[0])
        }
      }
      setLoading(false)
    })
  }, [])

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

  // Real-time updates via WebSocket
  const handleWsMessage = useCallback((event) => {
    if (event.type === 'new_message' || event.type === 'status_update') {
      refreshConversations()
    }
  }, [refreshConversations])

  useWebSocket(handleWsMessage)

  const handleAccountConnected = useCallback((newAccount) => {
    setAccounts((prev) => [...prev, newAccount])
    setActiveAccount(newAccount)
    setShowConnect(false)
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-gray-500">Loading dashboard...</div>
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
            <h2 className="text-xl font-semibold mb-2">Welcome to WA Connect</h2>
            <p className="text-gray-500 mb-6">Connect your WhatsApp Business Account to get started.</p>
            <button
              onClick={() => setShowConnect(true)}
              className="bg-green-600 text-white px-6 py-2 rounded-md font-medium hover:bg-green-700 transition-colors"
            >
              Connect WhatsApp
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (showConnect) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <Header user={user} logout={logout} />
        <div className="flex-1 flex items-center justify-center p-4">
          <ConnectAccount
            onConnected={handleAccountConnected}
            onCancel={() => setShowConnect(false)}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      <Header
        user={user}
        logout={logout}
        account={activeAccount}
        onConnect={() => setShowConnect(true)}
      />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar
          conversations={conversations}
          activeContact={activeContact}
          onSelectContact={setActiveContact}
          onRefresh={refreshConversations}
        />
        {activeContact && activeAccount ? (
          <ChatView
            accountId={activeAccount._id}
            contact={activeContact}
            onMessageSent={refreshConversations}
          />
        ) : (
          <EmptyState message="Seleccioná una conversación o esperá mensajes entrantes" account={activeAccount} />
        )}
      </div>
    </div>
  )
}

// --- Header ---

const Header = ({ user, logout, account, onConnect }) => (
  <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
    <div className="flex items-center gap-3">
      <h1 className="text-lg font-bold text-green-700">WA Connect</h1>
      {account && (
        <span className="text-sm text-gray-500">
          {account.business_name || account.display_phone || 'Connected'}
        </span>
      )}
    </div>
    <div className="flex items-center gap-4">
      {onConnect && (
        <button
          onClick={onConnect}
          className="text-sm text-green-600 hover:underline"
        >
          + Add Account
        </button>
      )}
      <span className="text-sm text-gray-500">{user?.name || user?.email}</span>
      <button
        onClick={logout}
        className="text-sm text-gray-400 hover:text-gray-600"
      >
        Logout
      </button>
    </div>
  </header>
)

export { DashboardPage }
