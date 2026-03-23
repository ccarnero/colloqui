// Chat view — shows message history for a contact and allows sending replies.
// Messages are displayed as bubbles: inbound on left, outbound on right.

import { useState, useEffect, useRef } from 'react'
import * as api from '../lib/api.js'
import { Send, FileText } from 'lucide-react'
import { TemplatePicker } from './TemplatePicker.jsx'

const formatTime = (dateStr) => {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

const statusIcon = (status) => {
  if (status === 'sent') return '\u2713'
  if (status === 'delivered') return '\u2713\u2713'
  if (status === 'read') return '\u2713\u2713'
  return ''
}

const ChatView = ({ accountId, contact, onMessageSent, refreshTick }) => {
  const [messages, setMessages] = useState([])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)
  const scrollRef = useRef(null)

  // Load messages when contact changes or when a WS event bumps refreshTick
  useEffect(() => {
    if (!contact) return

    api.getMessages(accountId, contact._id).then((result) => {
      if (result.ok) {
        setMessages(result.data.messages || [])
      }
    })
  }, [accountId, contact, refreshTick])

  // Scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  const handleSend = async (e) => {
    e.preventDefault()
    if (!text.trim() || sending) return

    setSending(true)
    const to = contact.wa_id || contact.phone || contact.bsuid
    const result = await api.sendMessage(accountId, to, text.trim())

    if (result.ok) {
      setText('')
      // Reload messages
      const msgResult = await api.getMessages(accountId, contact._id)
      if (msgResult.ok) {
        setMessages(msgResult.data.messages || [])
      }
      onMessageSent?.()
    }

    setSending(false)
  }

  const handleTemplateSent = async () => {
    setShowTemplates(false)
    // Reload messages
    const msgResult = await api.getMessages(accountId, contact._id)
    if (msgResult.ok) {
      setMessages(msgResult.data.messages || [])
    }
    onMessageSent?.()
  }

  const contactName = contact?.display_name || contact?.wa_id || 'Unknown'
  const contactSub = contact?.identifier_type === 'bsuid' ? 'BSUID' : contact?.phone || ''

  return (
    <div className="flex-1 flex flex-col bg-gray-50">
      {/* Chat header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between shrink-0">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{contactName}</h3>
          {contactSub && <p className="text-xs text-gray-400">{contactSub}</p>}
        </div>
        <button
          onClick={() => setShowTemplates(!showTemplates)}
          className="text-gray-400 hover:text-green-600 p-1"
          title="Send template"
        >
          <FileText size={18} />
        </button>
      </div>

      {/* Template picker overlay */}
      {showTemplates && (
        <TemplatePicker
          accountId={accountId}
          to={contact.wa_id || contact.phone || contact.bsuid}
          onSent={handleTemplateSent}
          onClose={() => setShowTemplates(false)}
        />
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-2 chat-scroll">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-sm text-gray-400">
            No messages yet
          </div>
        ) : (
          messages.map((msg) => (
            <MessageBubble key={msg._id} message={msg} />
          ))
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSend} className="bg-white border-t border-gray-200 px-4 py-3 flex gap-2 shrink-0">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 border border-gray-300 rounded-full px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="bg-green-600 text-white rounded-full p-2 hover:bg-green-700 disabled:opacity-50 transition-colors"
        >
          <Send size={18} />
        </button>
      </form>
    </div>
  )
}

const MessageBubble = ({ message }) => {
  const isOutbound = message.direction === 'outbound'
  const content = message.type === 'text'
    ? message.content?.text
    : message.type === 'template'
    ? `[Template: ${message.content?.template_name || ''}]`
    : `[${message.type}]`

  return (
    <div className={`flex ${isOutbound ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[70%] rounded-lg px-3 py-2 text-sm ${
          isOutbound
            ? 'bg-green-100 text-gray-900'
            : 'bg-white text-gray-900 shadow-sm'
        }`}
      >
        <p className="whitespace-pre-wrap break-words">{content}</p>
        <div className={`flex items-center gap-1 mt-1 ${isOutbound ? 'justify-end' : ''}`}>
          <span className="text-[10px] text-gray-400">
            {formatTime(message.created_at || message.timestamp)}
          </span>
          {isOutbound && (
            <span className={`text-[10px] ${message.status === 'read' ? 'text-blue-500' : 'text-gray-400'}`}>
              {statusIcon(message.status)}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

export { ChatView }
