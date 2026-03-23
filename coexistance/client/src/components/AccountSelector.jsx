// Account selector dropdown for multi-account switching.
// Shows active account with status badge, dropdown to switch.

import { useState, useRef, useEffect } from 'react'
import { ChevronDown, Building2, Phone } from 'lucide-react'

const AccountSelector = ({ accounts, activeAccount, onSelect }) => {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (!activeAccount || accounts.length < 2) {
    // Single account — just show the name, no dropdown
    return activeAccount ? (
      <span className="text-sm text-gray-500 truncate max-w-48">
        {activeAccount.business_name || activeAccount.display_phone || 'Cuenta conectada'}
      </span>
    ) : null
  }

  const label = activeAccount.business_name || activeAccount.display_phone || 'Cuenta'

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors px-2 py-1 rounded-md hover:bg-gray-100"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Cuenta activa: ${label}. Cambiar cuenta.`}
      >
        <Building2 size={14} className="text-gray-400 shrink-0" />
        <span className="truncate max-w-40">{label}</span>
        <ChevronDown size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label="Seleccionar cuenta"
          className="absolute top-full left-0 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1 max-h-60 overflow-y-auto"
        >
          {accounts.map((acct) => {
            const isActive = acct._id === activeAccount._id
            const name = acct.business_name || 'Sin nombre'
            const phone = acct.display_phone || acct.phone_number_id || ''

            return (
              <li
                key={acct._id}
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onSelect(acct)
                  setOpen(false)
                }}
                className={`px-3 py-2 cursor-pointer transition-colors ${
                  isActive
                    ? 'bg-green-50 border-l-2 border-l-green-500'
                    : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex items-center gap-2">
                  <Building2 size={14} className={isActive ? 'text-green-600' : 'text-gray-400'} />
                  <span className={`text-sm font-medium truncate ${isActive ? 'text-green-700' : 'text-gray-700'}`}>
                    {name}
                  </span>
                </div>
                {phone && (
                  <div className="flex items-center gap-1.5 mt-0.5 ml-5">
                    <Phone size={10} className="text-gray-300" />
                    <span className="text-xs text-gray-400">{phone}</span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export { AccountSelector }
