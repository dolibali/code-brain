# Code Brain

Code Brain is a local-first code knowledge brain for `Claude Code`, `Cursor`, `Codex`, and `Gemini CLI`.
It keeps Markdown as the source of truth, SQLite as the index, and exposes a thin-service tool surface through both CLI and MCP.

## Quickstart

1. Install dependencies:

```bash
./init.sh
```

2. Create a minimal config at `~/.code-brain/config.yaml`:

```yaml
brain:
  repo: ~/.code-brain/brain
  index_db: ~/.code-brain/index.sqlite

projects:
  - id: code-brain
    main_branch: main
    roots:
      - ~/work/code-brain
    git_remotes: []

llm:
  enabled: false
```

3. Register a project if it is not already in config:

```bash
codebrain project register \
  --id kilo-code \
  --root ~/work/kilo-code \
  --remote github.com/your-org/kilo-code \
  --main-branch main
```

4. Search before editing:

```bash
codebrain search "electron 沙箱 崩溃 preload" --context-path "$(pwd)"
```

5. Read an existing page before rewriting it:

```bash
codebrain get issue/electron-sandbox-crash --project kilo-code
```

6. Put a full markdown page after a task is stable:

```bash
codebrain put change/2026/2026-04-18-preload-bridge-fix \
  --project kilo-code \
  --file ./change.md
```

7. Link evidence to long-lived knowledge:

```bash
codebrain link \
  --project kilo-code \
  --from change/2026/2026-04-18-preload-bridge-fix \
  --to issue/electron-sandbox-crash \
  --relation updates
```

## Useful Commands

```bash
codebrain serve
codebrain project list
codebrain search "query" --project kilo-code
codebrain list --project kilo-code --types issue,practice
codebrain get issue/electron-sandbox-crash --project kilo-code
codebrain put practice/preload-bridge-rule --project kilo-code --file ./practice.md
codebrain links --project kilo-code --slug issue/electron-sandbox-crash
codebrain reindex --project kilo-code
```

## Thin Service Surface

Code Brain v1 intentionally keeps the service thin. The formal tool surface is:

- `search`
- `get_page`
- `list_pages`
- `put_page`
- `link_pages`
- `get_links`
- `reindex`

The service does not do `record_change`, automatic dedupe, automatic long-lived knowledge extraction, or hidden branch-based write rejection.

## Provider Presets

Code Brain uses an `OpenAI-compatible-first` configuration model.
These provider ids are supported in config and can be routed for search:

- `zhipu`
- `qwen_bailian`
- `minimax`
- `deepseek`
- `kimi`

Example:

```yaml
llm:
  enabled: true
  provider: deepseek
  providers:
    zhipu:
      mode: openai-compatible
      base_url: https://open.bigmodel.cn/api/paas/v4/
      api_key_env: ZHIPU_API_KEY
      default_model: glm-4.5
      capabilities: [chat_completions, reasoning_control]
    qwen_bailian:
      mode: openai-compatible
      base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
      api_key_env: DASHSCOPE_API_KEY
      default_model: qwen-max
      capabilities: [chat_completions, reasoning_control]
    minimax:
      mode: openai-compatible
      base_url: https://api.minimax.io/v1
      api_key_env: MINIMAX_API_KEY
      default_model: MiniMax-M1
      capabilities: [chat_completions, reasoning_control]
    deepseek:
      mode: openai-compatible
      base_url: https://api.deepseek.com
      api_key_env: DEEPSEEK_API_KEY
      default_model: deepseek-chat
      capabilities: [chat_completions, reasoning_control]
    kimi:
      mode: openai-compatible
      base_url: https://api.moonshot.cn/v1
      api_key_env: MOONSHOT_API_KEY
      default_model: kimi-k2
      capabilities: [chat_completions, reasoning_control]
  routing:
    search: deepseek
  request:
    extra_body: {}
  timeout_ms: 8000
  retries: 2
```

## Agent Loops

### Claude Code

- Prefer MCP: `codebrain serve`
- Workflow:
  `search` before non-trivial edits, then on `main_branch` run the explicit `brain_sync_task` recipe:
  `search -> get_page -> put change -> put long-lived page -> link_pages`

### Cursor

- Prefer MCP against the same `codebrain serve`
- Fallback to CLI:

```bash
codebrain search "query" --context-path "$(pwd)"
codebrain get practice/preload-bridge-rule --project kilo-code
codebrain put change/2026/2026-04-18-preload-bridge-fix --file ./change.md
```

### Codex

- Prefer MCP when available
- CLI fallback uses the same commands as Cursor and Claude Code.

### Gemini CLI

- v1 path is CLI-first:

```bash
codebrain search "query" --context-path "$(pwd)"
codebrain get practice/preload-bridge-rule --project kilo-code
codebrain put change/2026/2026-04-18-preload-bridge-fix --file ./change.md
```

## Notes

- Markdown remains the source of truth even if SQLite is rebuilt.
- `put_page` expects a full markdown page with valid frontmatter.
- Search defaults to the current project unless `--global` is passed.
- `main_branch` is a recipe-level write suggestion for Agents, not a hidden `put_page` server-side rejection rule.
