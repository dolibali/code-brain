# Claude Code Integration

Preferred setup:

```json
{
  "mcpServers": {
    "code-brain": {
      "command": "codebrain",
      "args": ["serve"]
    }
  }
}
```

Recommended rules:

- Search before non-trivial code edits.
- Read a page before overwriting it.
- After a stable task on `main_branch`, run the `brain_sync_task` recipe.
- Write `change` first, then long-lived knowledge, then links.
