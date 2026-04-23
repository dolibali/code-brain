# Codex Integration

Preferred setup is MCP over stdio:

```json
{
  "braincode": {
    "command": "braincode",
    "args": ["serve"]
  }
}
```

Recommended usage:

- Ask Codex to use `search` first for prior knowledge.
- Ask it to call `get_page` before rewriting an existing slug.
- For memory updates, have it follow `brain_sync_task`:
  `search -> get_page -> put change -> put long-lived page -> link_pages`
