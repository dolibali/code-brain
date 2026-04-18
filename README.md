# Code Brain

Code Brain is a local-first code knowledge brain for `Claude Code`, `Cursor`, `Codex`, and `Gemini CLI`.
It keeps Markdown as the source of truth, SQLite as the index, and exposes the same operations through CLI and MCP.

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
    root: ~/work/code-brain
    remotes: []
llm:
  enabled: false
```

3. Register a project if it is not already in config:

```bash
code-brain project register --id kilo-code --root ~/work/kilo-code --remote github.com/your-org/kilo-code
```

4. Search before editing:

```bash
code-brain search "electron 沙箱 崩溃 preload" --context-path "$(pwd)"
```

5. Record a finished task after editing:

```bash
code-brain change record \
  --project kilo-code \
  --commit-message "fix: electron sandbox crash" \
  --summary "修复 electron 沙箱启动崩溃，preload bridge 不再直接访问 Node API。" \
  --scope-ref file:src/main/preload.ts \
  --source-ref abc123
```

## Useful Commands

```bash
code-brain doctor
code-brain search "query" --project kilo-code
code-brain list --project kilo-code
code-brain get issue/electron-sandbox-crash --project kilo-code
code-brain change record --project kilo-code --summary-file ./summary.md
code-brain links --project kilo-code --slug issue/electron-sandbox-crash
code-brain reindex --project kilo-code
code-brain serve
```

## Provider Presets

Code Brain uses an `OpenAI-compatible-first` configuration model.
These provider ids are supported in config and can be routed per capability:

- `zhipu`
- `qwen_bailian`
- `minimax`
- `deepseek`
- `kimi`

Example:

```yaml
llm:
  enabled: true
  default_provider: deepseek
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
      capabilities: [chat_completions, responses_api]
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
      capabilities: [chat_completions]
    kimi:
      mode: openai-compatible
      base_url: https://api.moonshot.cn/v1
      api_key_env: MOONSHOT_API_KEY
      default_model: kimi-k2
      capabilities: [chat_completions, reasoning_control]
  routing:
    search: deepseek
    extract: qwen_bailian
    dedup: zhipu
```

## Agent Loops

### Claude Code

- Prefer MCP: `code-brain serve`
- Workflow:
  `search` before non-trivial edits, then `change record` after the task is done.

### Cursor

- Prefer MCP against the same `code-brain serve`
- Fallback to CLI:

```bash
code-brain search "query" --context-path "$(pwd)"
code-brain change record --context-path "$(pwd)" --summary-file ./summary.md
```

### Codex

- Prefer MCP when available
- CLI fallback uses the same commands as Cursor and Claude Code.

### Gemini CLI

- v1 path is CLI-first:

```bash
code-brain search "query" --context-path "$(pwd)"
code-brain change record --context-path "$(pwd)" --summary-file ./summary.md
```

## Notes

- Markdown remains the source of truth even if SQLite is rebuilt.
- `record_change` requires at least one of `diff`, `commit_message`, or `agent_summary`.
- Search defaults to the current project unless `--global` is passed.
