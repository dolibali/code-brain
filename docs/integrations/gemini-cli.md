# Gemini CLI Integration

Gemini CLI remains CLI-first in v1.

Recommended flow:

```bash
braincode search "query" --context "$(pwd)"
braincode get practice/preload-bridge-rule --project kilo-code
braincode put change/2026/2026-04-18-preload-bridge-fix --file ./change.md
braincode link --project kilo-code --from change/... --to issue/... --rel updates
```

Recommended rule:

- Use `search` and `get` for discovery.
- Prefer the stable `project` id across machines, and keep local absolute paths out of shared memory.
- Only write shared memory after the task result is stable and ready for reuse.
