# Code Brain

Code Brain is a local-first code knowledge brain for `Claude Code`, `Cursor`, `Codex`, and `Gemini CLI`.
It keeps Markdown as the source of truth, SQLite as the index, and exposes the same thin-service surface through both CLI and MCP.

## Install

Global install:

```bash
npm install -g code-brain
```

One-shot usage without a global install:

```bash
npx code-brain@latest --help
```

For local development in this repo:

```bash
./init.sh
```

## Quickstart

1. Initialize local state:

```bash
codebrain init
```

If you want a portable workspace-local setup instead of writing under `~/.code-brain`, initialize with an explicit config path:

```bash
codebrain --config ./tmp/code-brain/config.yaml init
```

In that mode, the generated `brain` and `state/index.sqlite` paths are written relative to the config file.

2. Register a project:

```bash
codebrain project register \
  --id kilo-code \
  --root ~/work/kilo-code \
  --remote github.com/your-org/kilo-code \
  --main-branch main
```

3. Search before editing:

```bash
codebrain search "electron 沙箱 崩溃 preload" --context-path "$(pwd)"
```

4. Read an existing page before rewriting it:

```bash
codebrain get issue/electron-sandbox-crash --project kilo-code
```

5. Put a full Markdown page after a task is stable:

```bash
codebrain put change/2026/2026-04-18-preload-bridge-fix \
  --project kilo-code \
  --file ./change.md
```

6. Link evidence to long-lived knowledge:

```bash
codebrain link \
  --project kilo-code \
  --from change/2026/2026-04-18-preload-bridge-fix \
  --to issue/electron-sandbox-crash \
  --relation updates
```

## CLI Surface

```bash
codebrain init
codebrain serve
codebrain project list
codebrain project register --id kilo-code --root ~/work/kilo-code --main-branch main
codebrain search "query" --project kilo-code
codebrain list --project kilo-code --types issue,practice
codebrain get issue/electron-sandbox-crash --project kilo-code
codebrain put practice/preload-bridge-rule --project kilo-code --file ./practice.md
codebrain link --project kilo-code --from change/... --to issue/... --relation updates
codebrain links --project kilo-code --slug issue/electron-sandbox-crash
codebrain reindex --project kilo-code
```

## Thin Service Contract

Code Brain v1 intentionally keeps the service thin. The formal tool surface is:

- `search`
- `get_page`
- `list_pages`
- `put_page`
- `link_pages`
- `get_links`
- `reindex`

The service does not do `record_change`, automatic dedupe, automatic long-lived knowledge extraction, or hidden branch-based write rejection.

## MCP Positioning

Code Brain MCP is **a code knowledge toolset over stdio**, not an autonomous memory agent.

- `search` returns candidate page summaries and related changes, not a final synthesized answer
- `get_page` returns the full Markdown truth page
- `put_page` overwrites one full page and does not auto-merge
- `link_pages` creates formal relationships and does not infer links from body text

Preferred MCP startup command:

```json
{
  "code-brain": {
    "command": "codebrain",
    "args": ["serve"]
  }
}
```

Do not use `npm run serve` in MCP client config. `stdio` MCP requires clean stdout for protocol traffic.

## Config

Minimal config created by `codebrain init`:

```yaml
brain:
  repo: ~/.code-brain/brain
  index_db: ~/.code-brain/index.sqlite

projects: []

llm:
  enabled: false

embedding:
  enabled: false

mcp:
  name: code-brain
  version: 0.2.0
```

### Search-side LLM

Code Brain only uses LLM on the search path:

- query understanding and expansion
- result reranking

It does not use LLM for write-side judgment or memory extraction.

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

### Optional Embedding Search

Embedding is optional and always sits behind the same `search` command.

```yaml
embedding:
  enabled: true
  provider: qwen_bailian
  model: text-embedding-v4
  providers:
    qwen_bailian:
      mode: openai-compatible
      base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
      api_key_env: DASHSCOPE_API_KEY
      default_model: text-embedding-v4
      capabilities: [embeddings]
  routing:
    search: qwen_bailian
  dimensions: 1024
  timeout_ms: 8000
  retries: 2
```

If the embedding provider is unavailable, Code Brain falls back to local FTS5.

## Agent Loop

The recommended shared recipe is documented in [docs/BRAIN_SYNC_RECIPE.md](/Users/zhangrich/work/code-brain/docs/BRAIN_SYNC_RECIPE.md:1).

Short version:

1. `search` before non-trivial edits
2. `get_page` before overwriting an existing page
3. After a stable task, write a `change` page first
4. Then update long-lived knowledge if needed
5. Use `link_pages` to connect the evidence graph

Integration notes:

- [Claude Code](/Users/zhangrich/work/code-brain/docs/integrations/claude-code.md:1)
- [Codex](/Users/zhangrich/work/code-brain/docs/integrations/codex.md:1)
- [Cursor](/Users/zhangrich/work/code-brain/docs/integrations/cursor.md:1)
- [Gemini CLI](/Users/zhangrich/work/code-brain/docs/integrations/gemini-cli.md:1)

## Notes

- Markdown remains the source of truth even if SQLite is rebuilt.
- `put_page` expects a full Markdown page with valid frontmatter.
- Search defaults to the current project unless `--global` is passed.
- `main_branch` is a recipe-level write suggestion for agents, not a hidden `put_page` server-side rejection rule.
- The current SQLite backend uses Node's built-in `node:sqlite`, which may print an experimental warning depending on your Node version.

## Smoke Tests

Repository-local smoke checks:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp
```
