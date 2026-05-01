# BrainCode

BrainCode is a local-first code knowledge brain for `Claude Code`, `Cursor`, `Codex`, and `Gemini CLI`.
It keeps Markdown as the source of truth, SQLite as the index, and exposes the same thin-service surface through both CLI and MCP.
It can also run as a single-user remote server when you want multiple machines to share one remote truth source.

## Install

Requires Node.js `>=22.20.0`.

Global install:

```bash
npm install -g braincode
```

Upgrade an existing global install:

```bash
npm install -g braincode@latest
```

One-shot usage without a global install:

```bash
npx braincode@latest --help
```

For local development in this repo:

```bash
./init.sh
```

## Quickstart

1. Run the setup wizard:

```bash
braincode setup
```

For scripted setup, use non-interactive mode:

```bash
braincode setup --non-interactive \
  --project-name kilo-code \
  --project-path ~/work/kilo-code \
  --project-url github.com/your-org/kilo-code \
  --branch main
```

`setup` guides local paths, project identity, optional LLM/embedding providers, remote sync, and MCP snippets. It stores provider base URLs, model names, and environment variable names in YAML. When you enter API keys or remote tokens interactively, setup writes them to a sibling env file such as `~/.braincode/env` with `0600` permissions; secrets are never written to `config.yaml`.

Minimal script-friendly initialization is still available:

```bash
braincode init
```

If you want a portable workspace-local setup instead of writing under `~/.braincode`, initialize with an explicit config path:

```bash
braincode --config ./tmp/braincode/config.yaml init
```

In that mode, the generated `brain` and `state/index.sqlite` paths are written relative to the config file.

2. Register another project manually when needed:

```bash
braincode project add \
  --name kilo-code \
  --path ~/work/kilo-code \
  --url github.com/your-org/kilo-code \
  --branch main
```

Equivalent short form:

```bash
braincode pj add -n kilo-code -p ~/work/kilo-code -u github.com/your-org/kilo-code -b main
```

`--name` is the stable project identity used by Markdown, SQLite, and remote sync. `--path` is only this machine's local mount for resolving `--context` or the current working directory, so different computers can register the same `--name/--url` with different paths without duplicating remote memory.

3. Search before editing:

```bash
braincode search "electron 沙箱 崩溃 preload" --context "$(pwd)"
```

4. Read an existing page before rewriting it:

```bash
braincode get issue/electron-sandbox-crash --project kilo-code
```

5. Put a full Markdown page after a task is stable:

```bash
braincode put change/2026/2026-04-18-preload-bridge-fix \
  --project kilo-code \
  --file ./change.md
```

6. Link evidence to long-lived knowledge:

```bash
braincode link \
  --project kilo-code \
  --from change/2026/2026-04-18-preload-bridge-fix \
  --to issue/electron-sandbox-crash \
  --rel updates
```

## CLI Surface

```bash
braincode init
braincode setup
braincode doctor
braincode config path
braincode config show
braincode config validate
braincode config edit
braincode serve
braincode serve --remote --ip 127.0.0.1 --port 7331
braincode project list
braincode pj ls
braincode project add --name kilo-code --path ~/work/kilo-code --branch main
braincode pj add -n kilo-code -p ~/work/kilo-code -b main
braincode search "query" --project kilo-code
braincode s "query" -p kilo-code
braincode list --project kilo-code --type issue,practice
braincode ls -p kilo-code -t issue,practice
braincode get issue/electron-sandbox-crash --project kilo-code
braincode put practice/preload-bridge-rule --project kilo-code --file ./practice.md
braincode link --project kilo-code --from change/... --to issue/... --rel updates
braincode links issue/electron-sandbox-crash --project kilo-code
braincode reindex --project kilo-code
braincode idx --all
braincode sync status
braincode sync pull
braincode sync push
```

## Thin Service Contract

BrainCode v1 intentionally keeps the service thin. The formal tool surface is:

- `search`
- `get_page`
- `list_pages`
- `put_page`
- `link_pages`
- `get_links`
- `reindex`

The service does not do `record_change`, automatic dedupe, automatic long-lived knowledge extraction, or hidden branch-based write rejection.

## MCP Positioning

BrainCode MCP is **a code knowledge toolset**, not an autonomous memory agent.

- `search` returns candidate page summaries and related changes, not a final synthesized answer
- `get_page` returns the full Markdown truth page
- `put_page` overwrites one full page and does not auto-merge
- `link_pages` creates formal relationships and does not infer links from body text

Preferred local MCP startup command:

```json
{
  "braincode": {
    "command": "braincode",
    "args": ["serve"]
  }
}
```

Do not use `npm run serve` in MCP client config. `stdio` MCP requires clean stdout for protocol traffic.

Remote MCP is available through Streamable HTTP at `/mcp`:

```bash
export BRAINCODE_SERVER_TOKEN="<token printed by braincode setup>"
braincode serve --remote --ip 127.0.0.1 --port 7331
```

Equivalent short form:

```bash
braincode serve -r -i 127.0.0.1 -p 7331
```

`braincode serve --remote` without `-i/-p` uses `server.host` and `server.port`; the generated defaults are `127.0.0.1:7331`.

For public access, put this HTTP server behind HTTPS/TLS and configure `server.auth_token_env`.

## Config

Recommended first-run command:

```bash
braincode setup
```

Minimal config created by `braincode init`:

```yaml
brain:
  repo: ~/.braincode/brain
  index_db: ~/.braincode/index.sqlite

projects: []

llm:
  enabled: false

embedding:
  enabled: false

mcp:
  name: braincode
  version: 0.1.0
```

### Remote Server and Manual Sync

Remote mode is single-user and center-source: the remote brain repo is the truth source, and local machines keep a manually refreshed cache.

```yaml
server:
  host: 127.0.0.1
  port: 7331
  auth_token_env: BRAINCODE_SERVER_TOKEN
  max_body_mb: 20

remote:
  url: https://brain.example.com
  token_env: BRAINCODE_REMOTE_TOKEN

sync:
  concurrency: 8
  compression: gzip
  prune_on_pull: true
```

`braincode setup` can generate and store the server token in the protected env file for this env var. It does not write the token to YAML; remote clients should set or store `BRAINCODE_REMOTE_TOKEN` to the same value when connecting.

Pull remote truth into the local cache:

```bash
export BRAINCODE_REMOTE_TOKEN="change-me"
braincode sync pull
```

Push local cache changes back to remote:

```bash
braincode sync push
```

`sync push` intentionally overwrites remote pages with local content when the same slug differs. Run `sync status` first when you want to inspect drift.

Remote sync identifies projects by `project id + git_remotes + main_branch`, never by absolute local paths. The remote server may store projects with `roots: []`; local machines keep their own `roots` only for cwd/context resolution. If two different project names use the same normalized Git remote, sync rejects the duplicate instead of creating a second memory space.

### Search-side LLM

BrainCode only uses LLM on the search path:

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

If the embedding provider is unavailable, BrainCode falls back to local FTS5.

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
- Do not write machine-specific absolute paths into page frontmatter, `scope_refs`, or remote sync metadata; use project ids and repo-relative paths instead.
- The current SQLite backend uses Node's built-in `node:sqlite`; BrainCode requires Node.js `>=22.20.0` so this works without an extra SQLite flag.

## Smoke Tests

Repository-local smoke checks:

```bash
npm run typecheck
npm test
npm run build
npm run smoke:mcp
```
