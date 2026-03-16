// Empty state placeholder for the chat area.

const EmptyState = ({ message, account }) => (
  <div className="flex-1 flex items-center justify-center bg-gray-50">
    <div className="text-center max-w-sm px-4">
      <div className="text-4xl mb-4 opacity-30">💬</div>
      <p className="text-gray-500 text-sm mb-4">{message}</p>
      {account && (
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-left text-xs text-gray-500 space-y-1">
          <p className="font-medium text-gray-700 mb-2">Cuenta activa:</p>
          <p>Business: {account.business_name || '—'}</p>
          <p>WABA: {account.waba_id}</p>
          <p>Phone ID: {account.phone_number_id}</p>
          <p>Status: <span className="text-green-600 font-medium">{account.status}</span></p>
        </div>
      )}
    </div>
  </div>
)

export { EmptyState }
