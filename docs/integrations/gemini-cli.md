# Gemini CLI Integration

Gemini CLI remains CLI-first in v1.

Recommended flow:

```bash
braincode search "query" --context-path "$(pwd)"
braincode get practice/preload-bridge-rule --project kilo-code
braincode put change/2026/2026-04-18-preload-bridge-fix --file ./change.md
braincode link --project kilo-code --from change/... --to issue/... --relation updates
```

Recommended rule:

- Use `search` and `get` for discovery.
- Only write shared memory after the task result is stable and ready for reuse.
