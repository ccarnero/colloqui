# System Tools Documentation

## Overview
These are the three core system tools available to the runtime agent. They provide communication, resource management, and memory persistence capabilities.

---

## 1. `communicate` Tool

### Description
Sends messages, replies, notifications, or escalations to a target through the backend. Used for outbound communication across channels.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | `str` | ✅ Yes | — | Action type: `"send"`, `"reply"`, `"notify"`, or `"escalate"` |
| `target_id` | `str` | ✅ Yes | — | Recipient identifier (user ID, thread ID, etc.) |
| `message` | `str` | ❌ No | `""` | Message content to send |
| `channel` | `str` | ❌ No | `"whatsapp"` | Communication channel: `"whatsapp"`, `"email"`, `"sms"`, `"push"` |
| `priority` | `str` | ❌ No | `"medium"` | Priority level: `"low"`, `"medium"`, `"high"`, `"urgent"` |
| `context` | `str` | ❌ No | `""` | Additional context about the communication |
| `metadata` | `dict` | ❌ No | `None` | Custom metadata dictionary (e.g., `{"ticket_id": "123"}`) |

### Usage Examples

```python
# Send a message
result = await registry.communicate(
    action="send",
    target_id="user_456",
    message="Your order is ready for pickup",
    channel="whatsapp",
    priority="high"
)

# Reply to a thread
result = await registry.communicate(
    action="reply",
    target_id="thread_789",
    message="Thank you for your feedback",
    channel="email",
    priority="medium",
    metadata={"request_id": "REQ-001"}
)

# Escalate to support
result = await registry.communicate(
    action="escalate",
    target_id="conversation_123",
    context="Customer complaint - needs manager review",
    priority="urgent"
)
```

### Response Format

#### Success Response
```json
{
  "success": true,
  "action": "send",
  "target_id": "user_456",
  "message": "Your order is ready for pickup",
  "channel": "whatsapp",
  "priority": "high",
  "context": "",
  "timestamp": "2026-03-26T10:30:00Z",
  "message_id": "msg_abc123",
  "delivery_status": "sent"
}
```

#### Error Response
```json
{
  "success": false,
  "action": "send",
  "target_id": "user_456",
  "message": "Your order is ready for pickup",
  "channel": "whatsapp",
  "priority": "high",
  "context": "",
  "error": "Invalid channel type"
}
```

### Supported Actions
- **`send`**: Send a new message
- **`reply`**: Reply to an existing conversation
- **`notify`**: Send a notification without conversation context
- **`escalate`**: Escalate to higher tier support

---

## 2. `resource` Tool

### Description
Reads or updates external resources through the backend. Used for CRUD operations on domain objects like users, tickets, orders, etc.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | `str` | ✅ Yes | — | Action type: `"read"`, `"list"`, `"create"`, `"update"`, or `"delete"` |
| `resource_type` | `str` | ✅ Yes | — | Resource type (lowercase): `"user"`, `"ticket"`, `"order"`, `"agent"`, etc. |
| `resource_id` | `str` | ❌ No | `""` | Specific resource ID (required for `read`, `update`, `delete`) |
| `filters` | `dict` | ❌ No | `None` | Query filters for `list` action (e.g., `{"status": "open", "priority": "high"}`) |
| `patch` | `dict` | ❌ No | `None` | Fields to update (for `update` action) |

### Usage Examples

```python
# Read a specific user
result = await registry.resource(
    action="read",
    resource_type="user",
    resource_id="user_789"
)

# List all open tickets
result = await registry.resource(
    action="list",
    resource_type="ticket",
    filters={"status": "open", "priority": "high"},
    limit=50
)

# Create a new ticket
result = await registry.resource(
    action="create",
    resource_type="ticket",
    patch={
        "title": "Payment failed",
        "description": "User cannot checkout",
        "priority": "high"
    }
)

# Update ticket status
result = await registry.resource(
    action="update",
    resource_type="ticket",
    resource_id="ticket_123",
    patch={"status": "resolved", "resolution_notes": "Applied refund"}
)

# Delete a draft
result = await registry.resource(
    action="delete",
    resource_type="draft",
    resource_id="draft_456"
)
```

### Response Format

#### Read Success Response
```json
{
  "success": true,
  "action": "read",
  "resource_type": "user",
  "resource_id": "user_789",
  "id": "user_789",
  "name": "Alice Johnson",
  "email": "alice@example.com",
  "status": "active",
  "created_at": "2025-01-15T08:00:00Z"
}
```

#### List Success Response
```json
{
  "success": true,
  "action": "list",
  "resource_type": "ticket",
  "items": [
    {
      "id": "ticket_123",
      "title": "Payment failed",
      "status": "open",
      "priority": "high"
    },
    {
      "id": "ticket_124",
      "title": "Shipping delay",
      "status": "open",
      "priority": "medium"
    }
  ],
  "total": 2
}
```

#### Create Success Response
```json
{
  "success": true,
  "action": "create",
  "resource_type": "ticket",
  "id": "ticket_999",
  "title": "Payment failed",
  "description": "User cannot checkout",
  "priority": "high",
  "status": "open",
  "created_at": "2026-03-26T10:30:00Z"
}
```

#### Error Response
```json
{
  "success": false,
  "action": "read",
  "resource_type": "user",
  "resource_id": "user_999",
  "items": [],
  "error": "Resource not found"
}
```

### Supported Actions
- **`read`**: Fetch a single resource by ID
- **`list`**: Fetch multiple resources with optional filters
- **`create`**: Create a new resource
- **`update`**: Update an existing resource
- **`delete`**: Delete a resource

---

## 3. `memory` Tool

### Description
Stores or retrieves runtime-local memory organized by namespaces. Used for maintaining conversation state, agent decisions, and contextual data during execution.

### Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `action` | `str` | ✅ Yes | — | Action type: `"put"`, `"get"`, `"search"`, or `"delete"` |
| `namespace` | `str` | ✅ Yes | — | Memory namespace (e.g., `"conversation"`, `"agent_state"`, `"session_12345"`) |
| `key` | `str` | ❌ No | `""` | Memory key (required for `put`, `get`, `delete`) |
| `value` | `Any` | ❌ No | `None` | Value to store (any JSON-serializable object) |
| `query` | `str` | ❌ No | `""` | Search query string (for `search` action) |
| `limit` | `int` | ❌ No | `10` | Maximum number of results for `search` |
| `metadata` | `dict` | ❌ No | `None` | Optional metadata for storing with the value |

### Usage Examples

```python
# Store conversation state
result = await registry.memory(
    action="put",
    namespace="conversation_123",
    key="user_sentiment",
    value="positive",
    metadata={"score": 0.85, "updated_at": "2026-03-26T10:30:00Z"}
)

# Retrieve a stored value
result = await registry.memory(
    action="get",
    namespace="conversation_123",
    key="user_sentiment"
)

# Store agent decision
result = await registry.memory(
    action="put",
    namespace="agent_state",
    key="next_action",
    value={
        "intent": "escalate",
        "reason": "User requested manager review",
        "priority": "high"
    }
)

# Search for related memories
result = await registry.memory(
    action="search",
    namespace="conversation_123",
    query="sentiment",
    limit=5
)

# Delete a memory entry
result = await registry.memory(
    action="delete",
    namespace="conversation_123",
    key="old_context"
)
```

### Response Format

#### Put Response
```json
{
  "success": true,
  "action": "put",
  "namespace": "conversation_123",
  "key": "user_sentiment",
  "value": "positive",
  "metadata": {
    "score": 0.85,
    "updated_at": "2026-03-26T10:30:00Z"
  }
}
```

#### Get Success Response
```json
{
  "success": true,
  "action": "get",
  "namespace": "conversation_123",
  "key": "user_sentiment",
  "value": "positive",
  "metadata": {
    "score": 0.85,
    "updated_at": "2026-03-26T10:30:00Z"
  }
}
```

#### Get Not Found Response
```json
{
  "success": false,
  "action": "get",
  "namespace": "conversation_123",
  "key": "nonexistent_key",
  "value": null
}
```

#### Search Response
```json
{
  "success": true,
  "action": "search",
  "namespace": "conversation_123",
  "items": [
    {
      "key": "user_sentiment",
      "value": "positive",
      "metadata": {"score": 0.85}
    },
    {
      "key": "sentiment_reasoning",
      "value": "Customer satisfied with resolution",
      "metadata": {}
    }
  ]
}
```

#### Delete Response
```json
{
  "success": true,
  "action": "delete",
  "namespace": "conversation_123",
  "key": "old_context"
}
```

### Supported Actions
- **`put`**: Store a value in memory
- **`get`**: Retrieve a specific value by key
- **`search`**: Search values by query string (case-insensitive substring match)
- **`delete`**: Remove a memory entry

---

## Error Handling

### Common Error Scenarios

| Scenario | Error Message | Resolution |
|----------|---------------|-----------|
| Missing required parameter | `"action and target_id are required"` | Provide both `action` and required IDs |
| Invalid action | `"Unsupported memory action: xyz"` | Use one of the supported actions |
| Communication failure | `"Failed to communicate: [reason]"` | Check backend connectivity |
| Resource not found | `"Resource not found"` | Verify resource ID exists |
| Validation error | `"Invalid [field] type"` | Check parameter types |

### All Error Responses Include
```json
{
  "success": false,
  "error": "Reason for failure",
  "action": "[action name]",
  "[other relevant fields]": "..."
}
```

---

## Best Practices

### communicate
- Always use lowercase action names: `"send"`, `"reply"`, `"notify"`, `"escalate"`
- Validate channel before calling (supported: whatsapp, email, sms, push)
- Include context for escalations to help support teams

### resource
- Always use lowercase resource types: `"user"`, `"ticket"`, `"order"`
- For list operations, include filters to reduce data transfer
- Use `patch` only for `update` operations

### memory
- Use descriptive namespace names that relate to the session/thread
- Store structured data (JSON objects) instead of raw strings
- Search results are limited to prevent memory bloat
- Clean up old memory entries with `delete` when no longer needed

---

## Implementation Notes

- All tools are asynchronous (`async`/`await`)
- All string inputs are automatically trimmed and normalized
- All responses include a `success` boolean indicator
- Request/response cycle is logged for debugging
