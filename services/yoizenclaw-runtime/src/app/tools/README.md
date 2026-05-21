# System Tools Quick Reference

## 📖 Documentation Files

| File | Purpose |
|------|---------|
| `SYSTEM_TOOLS.md` | Complete markdown documentation with examples and best practices |
| `system_tools_schema.json` | Machine-readable JSON schema for programmatic parsing |
| `registry.py` | Implementation with detailed docstrings |

---

## ⚡ Quick Start

All three system tools are methods on the `ToolRegistry` instance:

```python
from src.tools import ToolRegistry

registry = ToolRegistry()

# Use communicate
result = await registry.communicate(action="send", target_id="user_123", message="Hello")

# Use resource
result = await registry.resource(action="list", resource_type="ticket", filters={"status": "open"})

# Use memory
result = await registry.memory(action="put", namespace="conv_123", key="sentiment", value="positive")
```

---

## 🎯 Tool Summary

### communicate
- **Purpose**: Send messages, notifications, escalations
- **Required**: `action`, `target_id`
- **Actions**: send, reply, notify, escalate
- **Returns**: `{success, message_id, delivery_status, ...}`

### resource
- **Purpose**: CRUD operations on domain objects
- **Required**: `action`, `resource_type`
- **Actions**: read, list, create, update, delete
- **Returns**: `{success, items, total, ...}` (for list) or single resource

### memory
- **Purpose**: Store/retrieve runtime state in namespaces
- **Required**: `action`, `namespace`
- **Actions**: put, get, search, delete
- **Returns**: `{success, key, value, metadata, ...}` or `{success, items}`

---

## 📝 How the LLM Should Use These

1. **Check documentation first**: Read `SYSTEM_TOOLS.md` for examples and best practices
2. **Parse schema**: Use `system_tools_schema.json` to understand parameters and response formats
3. **Validate inputs**: Ensure action and required parameters match the schema
4. **Handle responses**: Always check the `success` field before using response data
5. **Error handling**: Inspect error messages to guide the user on what went wrong

---

## 🔄 Response Pattern

All tools follow this consistent pattern:

```python
{
    "success": bool,           # Always present
    "action": str,            # Echo of input action
    "[resource_id|namespace|target_id]": str,  # Context field
    # ... action-specific fields ...
    "error": str  # Only if success=False
}
```

**Always check `success` before proceeding with response data.**

---

## 🚀 Integration with Agent Systems

### For Prompt Engineers
Include this reference in system prompts:

```markdown
# Available System Tools

The agent has access to three system tools:

1. **communicate**: Send messages and notifications
2. **resource**: CRUD operations on data
3. **memory**: Store and retrieve conversation state

See /src/tools/SYSTEM_TOOLS.md for complete documentation and examples.
```

### For LLM Tool Calling
Define these in your function/tool schemas:

```json
{
  "name": "communicate",
  "type": "function",
  "description": "Send messages through the backend (whatsapp, email, sms, push)",
  "parameters": {
    "type": "object",
    "required": ["action", "target_id"],
    "properties": {
      "action": {"type": "string", "enum": ["send", "reply", "notify", "escalate"]},
      "target_id": {"type": "string"},
      "message": {"type": "string"},
      "channel": {"type": "string", "enum": ["whatsapp", "email", "sms", "push"]},
      "priority": {"type": "string", "enum": ["low", "medium", "high", "urgent"]},
      "context": {"type": "string"},
      "metadata": {"type": "object"}
    }
  }
}
```

The `system_tools_schema.json` file can be converted to tool definitions programmatically.

---

## 🔧 Editing & Extending

These docs are editable and designed to evolve. When modifying:

1. **Add new action**: Update SYSTEM_TOOLS.md example, schema.json, and module docstring
2. **Change parameter**: Update both markdown and JSON schema for consistency
3. **Fix docs**: Keep markdown and schema in sync
4. **Add error case**: Include in "Error Handling" section of markdown

---

## 📊 Test Coverage

For each tool, consider testing:
- ✅ Success case with all parameters
- ✅ Success case with minimal parameters (using defaults)
- ✅ Missing required parameter (error case)
- ✅ Invalid action (error case)
- ✅ Backend timeout/failure (error case)
