// Conversation list sidebar.
// Shows contacts sorted by last message, with preview text and timestamp.

import { RefreshCw } from 'lucide-react'

const formatTime = (dateStr) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()

  if (isToday) {
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

const getPreview = (msg) => {
  if (!msg) return 'No messages yet'
  if (msg.type === 'text') return msg.content?.text || ''
  if (msg.type === 'template') return `[Template: ${msg.content?.template_name || ''}]`
  if (msg.type === 'image') return '[Image]'
  if (msg.type === 'audio') return '[Audio]'
  if (msg.type === 'video') return '[Video]'
  if (msg.type === 'document') return '[Document]'
  return `[${msg.type}]`
}

const Sidebar = ({ conversations, activeContact, onSelectContact, onRefresh }) => (
  <aside className="w-80 border-r border-gray-200 bg-white flex flex-col shrink-0">
    <div className="p-3 border-b border-gray-100 flex items-center justify-between">
      <h2 className="text-sm font-semibold text-gray-700">Conversations</h2>
      <button
        onClick={onRefresh}
        className="text-gray-400 hover:text-gray-600 p-1"
        title="Refresh"
      >
        <RefreshCw size={14} />
      </button>
    </div>

    <div className="flex-1 overflow-y-auto">
      {conversations.length === 0 ? (
        <div className="p-6 text-center">
          <div className="text-green-600 text-2xl mb-3">✓</div>
          <p className="text-sm font-medium text-gray-700 mb-2">Cuenta conectada</p>
          <p className="text-xs text-gray-400 leading-relaxed">
            No hay conversaciones todavía. Los mensajes entrantes aparecerán acá automáticamente.
            Para iniciar una conversación, enviá un template desde la API.
          </p>
        </div>
      ) : (
        conversations.map((conv) => (
          <ConversationItem
            key={conv._id}
            conversation={conv}
            isActive={activeContact?._id === conv._id}
            onClick={() => onSelectContact(conv)}
          />
        ))
      )}
    </div>
  </aside>
)

const ConversationItem = ({ conversation, isActive, onClick }) => {
  const name = conversation.display_name || conversation.wa_id || 'Unknown'
  const preview = getPreview(conversation.last_message)
  const time = formatTime(conversation.last_message?.created_at || conversation.last_message_at)

  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors ${
        isActive ? 'bg-green-50 border-l-2 border-l-green-500' : ''
      }`}
    >
      <div className="flex justify-between items-start mb-1">
        <span className="text-sm font-medium text-gray-900 truncate">{name}</span>
        <span className="text-xs text-gray-400 shrink-0 ml-2">{time}</span>
      </div>
      <p className="text-xs text-gray-500 truncate">{preview}</p>
    </button>
  )
}

export { Sidebar }
