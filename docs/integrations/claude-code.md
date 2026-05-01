# Claude Code Integration

Preferred setup:

```json
{
  "mcpServers": {
    "braincode": {
      "command": "braincode",
      "args": ["serve"]
    }
  }
}
```

Recommended rules:

- Search before non-trivial code edits.
- Read a page before overwriting it.
- Pass the stable `project` id across machines; do not store local absolute paths in memory pages.
- After a stable task on `main_branch`, run the `brain_sync_task` recipe.
- Write `change` first, then long-lived knowledge, then links.
