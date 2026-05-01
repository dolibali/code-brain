# Cursor Integration

Preferred setup is MCP over stdio with the `braincode serve` command.

If MCP is unavailable, Cursor can still use the same CLI flow:

```bash
braincode search "query" --context "$(pwd)"
braincode get practice/preload-bridge-rule --project kilo-code
braincode put change/2026/2026-04-18-preload-bridge-fix --file ./change.md
```

Recommended rule:

- Use `search` and `get_page` as the read path.
- Prefer the stable `project` id when working across machines; `--context` is only a local path hint.
- Use `put_page` and `link_pages` only after the task result is stable.
