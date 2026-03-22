// Template picker — loads templates from Meta, lets user select one and send it.

import { useState, useEffect } from 'react'
import * as api from '../lib/api.js'
import { X } from 'lucide-react'

const TemplatePicker = ({ accountId, to, onSent, onClose }) => {
  const [templates, setTemplates] = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    api.getTemplates(accountId).then((result) => {
      if (result.ok) {
        setTemplates(result.data.templates || [])
      } else {
        setError('Failed to load templates')
      }
      setLoading(false)
    })
  }, [accountId])

  const handleSend = async (template) => {
    setSending(true)
    setError(null)

    const result = await api.sendTemplate(
      accountId,
      to,
      template.name,
      template.language || 'en_US',
      []
    )

    if (result.ok) {
      onSent?.()
    } else {
      setError(typeof result.error === 'string' ? result.error : 'Failed to send template')
    }

    setSending(false)
  }

  return (
    <div className="bg-white border-b border-gray-200 p-4 max-h-64 overflow-y-auto">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-700">Send Template</h4>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <X size={16} />
        </button>
      </div>

      {error && <div className="text-sm text-red-600 mb-2">{error}</div>}

      {loading ? (
        <div className="text-sm text-gray-400">Loading templates...</div>
      ) : templates.length === 0 ? (
        <div className="text-sm text-gray-400">No approved templates found.</div>
      ) : (
        <div className="space-y-2">
          {templates.map((t) => (
            <div
              key={t.id || t.name}
              className="flex items-center justify-between bg-gray-50 rounded p-2"
            >
              <div>
                <span className="text-sm font-medium text-gray-800">{t.name}</span>
                <span className="text-xs text-gray-400 ml-2">
                  {t.language || 'en_US'} — {t.status || 'approved'}
                </span>
              </div>
              <button
                onClick={() => handleSend(t)}
                disabled={sending}
                className="text-xs bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700 disabled:opacity-50"
              >
                Send
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export { TemplatePicker }
