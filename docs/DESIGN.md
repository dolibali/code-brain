# Code Brain — 跨 Agent 代码知识脑库 MCP Server

> **版本：** v0.2-spec  
> **日期：** 2026-04-18  
> **作者：** zhangrich  
> **状态：** 可实施设计稿

---

## 一、产品定义

### 1.1 一句话定位

**Code Brain 是一个面向重度 AI 编程者的多项目代码知识脑库：让 Claude Code、Cursor、Codex、Gemini CLI 共享同一套代码事实、开发过程和决策上下文。**

它不是通用个人知识库，也不是单一 Agent 的提示词文件集合，而是一个：

- **以 Markdown 为真相源** 的脑库仓库
- **以 SQLite 为全局索引层** 的本地检索系统
- **以 MCP 为首选接入方式**、CLI 为补位的跨 Agent 服务
- **以代码知识为核心模型** 的知识库，而不是通用实体图谱

### 1.2 目标用户

v1 面向以下用户画像：

- 会在同一代码库里频繁切换多个 AI Agent
- 日常开发中既要查 bug 修复，也要查架构、约定和历史决策
- 希望知识能直接进 git、可读、可改、可审计
- 不想维护额外数据库服务，也不想把产品建立在 embedding 必需之上

v1 仍然以 **单用户使用** 为前提，但从第一天起按 **可复用的通用产品** 设计，而不是只为某一个项目或某一种个人工作流写死。

### 1.3 典型问题

Code Brain 主要解决以下问题：

1. **重复排障**
   一个 Agent 修过的问题，另一个 Agent 几天后完全不知道，又重新排查。
2. **架构知识丢失**
   模块边界、依赖关系、历史重构原因没有沉淀，新 Agent 按旧结构继续写。
3. **开发约定不继承**
   比如 preload 不能直接访问 Node API、某层不能越界调用、某目录只允许某种模式，这些规则很容易随 session 结束而消失。
4. **开发过程不可追溯**
   代码改了，但为什么改、改动影响了什么、是 bugfix 还是重构、有没有回滚过，后续很难重新拼起来。
5. **技术决策上下文缺失**
   一个月前为什么选 A 不选 B，当时的取舍是什么，后续 revisit 条件是什么，新 Agent 无法继承。

### 1.4 成功标准

Code Brain 的 v1 成功标准不是“能存几篇文档”，而是以下闭环能稳定工作：

1. Agent 在做非 trivial 修改前，能先查到当前项目相关知识。
2. 一次有意义的任务完成后，系统能自动沉淀一条 `change` 记录。
3. 同一任务涉及的长期知识能被自动更新或关联到 `issue / architecture / decision / practice` 页面。
4. 搜索能同时支持中文描述、英文模块名、报错原文、文件路径和符号名混合输入。
5. Markdown 文件和 SQLite 索引保持一致，且故障时可以从 Markdown 全量重建。

### 1.5 非目标

以下内容明确不在 v1 范围内：

| 非目标 | 说明 |
|---|---|
| 多用户协作与权限控制 | v1 明确是单用户产品 |
| Web UI | 以 MCP、CLI、Markdown 为主 |
| 云端托管服务 | 本地运行即可 |
| 通用个人知识管理 | 不做 people/company/meeting/email/calendar |
| 会议或完整聊天转录入库 | v1 只接受 `diff + commit + Agent 显式总结` |
| embedding 必需 | 可作为未来优化位，但不是 v1 前提 |

---

## 二、设计原则

### 2.1 受 GBrain 启发，但不照搬

Code Brain 借鉴 GBrain 的三点思想：

1. **Compiled Truth + Timeline**
   页面上层是当前最佳理解，下层是时间线证据。
2. **Repo/Human First**
   人类可直接读写 Markdown，系统始终可以从文件重建索引。
3. **稳定操作面**
   对外暴露稳定工具；增强能力由服务内部或 Agent 规则决定，而不是暴露两套心智。

Code Brain 不照搬 GBrain 的部分：

- 不以个人知识管理为建模对象
- 不以向量搜索为核心前提
- 不把技能体系当主要产品表面
- 不把 Postgres/Supabase 当默认依赖

### 2.2 核心原则

1. **Markdown 必选，SQLite 必选，LLM 增强可选**
   Markdown 是真相源；SQLite 是索引和查询层；LLM 是体验增强层。
2. **MCP 优先，CLI 补位**
   所有正式能力都以 MCP 为主接口；CLI 用于调试、批处理、无 MCP 场景和脚本化接入。
3. **少类型，多维度**
   顶层页面类型保持稳定，复杂语义通过结构化维度表达，而不是不断膨胀类型数。
4. **质量优先的搜索**
   默认允许 LLM 参与查询理解和重排；若失败，再回落到本地 FTS5。
5. **开发过程也是一等知识**
   不是只记录“结论”，还要记录“发生过什么变更、为什么这样变”。
6. **中央脑库，项目隔离**
   默认一个 brain repo 管多个项目；日常搜索按当前项目优先，必要时再跨项目搜索。

---

## 三、系统架构

### 3.1 总体架构

```text
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Claude Code  │   │    Cursor    │   │    Codex     │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │                  │                  │
       └──────────────────┼──────────────────┘
                          │
                    MCP 优先 / CLI 补位
                          │
                ┌─────────▼─────────┐
                │    Code Brain     │
                │                   │
                │  Project Resolver │  -> 识别当前项目
                │  Search Engine    │  -> FTS5 + LLM 增强
                │  Ingest Engine    │  -> diff/commit/summary 提取
                │  Sync Engine      │  -> Markdown -> SQLite write-through
                └───────┬───────────┘
                        │
        ┌───────────────┴────────────────┐
        │                                │
┌───────▼────────┐              ┌────────▼────────┐
│ Brain Repo     │              │ SQLite Index    │
│ Markdown files │              │ 全局索引与过滤层 │
│ source of truth│              │ 可从 Markdown 重建 │
└────────────────┘              └─────────────────┘
```

### 3.2 必选与可选组件

| 组件 | 是否必选 | 作用 |
|---|---|---|
| Brain Repo（Markdown） | 必选 | 真相源，人类可读，可进 git |
| SQLite + FTS5 | 必选 | 全局索引、过滤、排序、快速查询 |
| LLM 增强层 | 可选 | 查询理解与扩展、结果重排、知识提取、去重判断 |

### 3.3 默认部署模型

默认部署是：

- 一个本地运行的 `code-brain serve`
- 一个本地 brain repo
- 一个本地 SQLite 索引库
- 一个可选的 OpenAI-compatible LLM 配置

**默认不是**：

- 每个项目各起一个独立服务
- 每个项目一套单独数据库
- 云端共享服务

### 3.4 脑库仓库结构

v1 默认采用 **集中脑库仓库**：

```text
brain-repo/
├── projects/
│   ├── kilo-code/
│   │   ├── project.yaml
│   │   └── pages/
│   │       ├── issues/
│   │       ├── architecture/
│   │       ├── decisions/
│   │       ├── practices/
│   │       └── changes/
│   │           └── 2026/
│   └── another-project/
│       ├── project.yaml
│       └── pages/
└── README.md
```

路径约定：

- 长期知识页：
  - `projects/<project>/pages/issues/<slug>.md`
  - `projects/<project>/pages/architecture/<slug>.md`
  - `projects/<project>/pages/decisions/<slug>.md`
  - `projects/<project>/pages/practices/<slug>.md`
- 开发过程页：
  - `projects/<project>/pages/changes/<year>/<date>-<slug>.md`

`change` 页面按年份分目录，是因为这类页面数量通常最多，且天然带时间序。

brain repo 的管理约束：

- **推荐且默认假设该仓库由 git 管理**
- Markdown 是真相源，git 负责页面级历史追踪与回滚
- v1 不额外设计独立的页面版本表来替代 git

### 3.5 项目识别机制

Code Brain 默认按以下优先级识别当前项目：

1. **Agent 显式传入 `project`**
   这是首选路径，也是最可靠的项目解析方式
2. **Agent 或调用方传入 `context_path`**
   由 Code Brain 根据路径进一步推断项目
3. **服务进程工作目录**
   如果服务启动时就位于某个已注册项目根目录下
4. **配置中的本地路径映射**
   `roots` 与当前 cwd 前缀匹配
5. **配置中的 git remote 映射**
   通过仓库 remote URL 匹配项目
6. **唯一项目兜底**
   如果只注册了一个项目，则默认使用它

若以上均失败，则返回“项目未解析”，由调用方显式指定或先注册项目。

这里的原则是：

- **Agent 明确告诉 Code Brain 当前项目，优先于 Code Brain 自行猜测**
- 自动项目识别是兜底能力，不是主交互模式

### 3.6 推荐实现基线

虽然语言和中间件尚未最终拍板，但 v1 的**推荐实现基线**已经明确：

- **单进程本地服务**
- **同一进程内完成项目解析、索引、搜索、提取和同步**
- **通过模块边界分层，而不是一开始拆成多服务或独立 worker**

推荐这样做的原因：

- 更贴合单用户、本地优先、SQLite 嵌入式的产品前提
- 更适合 AI 辅助快速迭代
- 更容易把 `search / record_change / reindex` 做成一致的 contract
- 出现问题时更容易调试和重建

v1 **不默认采用** 以下架构作为起点：

- 插件化 engine/provider 内核
- 搜索服务、同步服务、提取服务的多进程拆分
- 远程数据库或云端任务队列

这些能力可以在后续规模化阶段演进，但不是 v1 的默认复杂度。

### 3.7 技术路线与候选实现

产品层已经锁定的硬约束只有这些：

- MCP 是首选接入协议
- Markdown 是真相源
- SQLite 是正式索引方案
- LLM 增强可选，但接口层保持 `OpenAI-compatible-first`

在这些硬约束之上，v1 保留两条候选实现路线：

| 类别 | TypeScript 路线 | Python 路线 | 当前建议 |
|---|---|---|---|
| 语言/运行时 | TypeScript + JavaScript 运行时 | Python + 本地解释器运行时 | **推荐 TypeScript**，因 MCP 生态更贴近目标 Agent 环境 |
| MCP 框架 | JavaScript/TypeScript MCP server 框架族 | Python MCP server 框架族 | 两条都可行，优先选生态更成熟、文档更稳定的一侧 |
| SQLite 驱动 | 本地嵌入式 SQLite 驱动 | 本地 SQLite 驱动或标准库封装 | 只比较驱动体验，不更换 SQLite 本身 |
| Markdown/frontmatter | Markdown AST/Frontmatter 解析库族 | Markdown/Frontmatter 解析库族 | 优先选能稳定 round-trip frontmatter 的方案 |
| 配置管理 | YAML + env 配置层 | YAML + env 配置层 | 都需支持单文件配置和环境变量覆盖 |
| CLI 方案 | JavaScript CLI 框架族 | Python CLI 框架族 | 优先选择与 MCP operations 共用定义最顺的方案 |
| 测试方案 | JS/TS 单元 + 集成 + E2E 测试栈 | Python 单元 + 集成 + E2E 测试栈 | 两侧都要覆盖 write-through、reindex、搜索降级 |

这里的“推荐”不是最终锁定实现，而是：

- 当前更倾向优先尝试 TypeScript 路线
- 若 Python 路线在 MCP 接入、SQLite 集成和 AI 开发效率上更顺，可以切换
- 切换语言不应改变产品 contract、数据模型和对外工具面

### 3.8 技术选择标准

后续拍板语言或中间件时，统一按以下标准判断，而不是按个人偏好拍脑袋：

1. **易部署**
   本地启动简单，不依赖额外数据库服务
2. **跨平台**
   至少保证 macOS 优先，同时不阻断未来在 Linux/Windows 运行
3. **MCP 兼容**
   能稳定提供 stdio MCP 服务，并易于接入 Claude Code、Cursor、Codex，同时可通过 CLI 方式接入 Gemini CLI
4. **SQLite 集成成熟度**
   支持本地嵌入式、FTS5、可靠事务和可预期的并发行为
5. **Markdown/frontmatter 稳定性**
   能安全读写 frontmatter，避免 round-trip 破坏内容结构
6. **适合 AI 快速迭代**
   易生成、易调试、易重构、易补测试

### 3.9 LLM 供应商兼容策略

Code Brain 的 LLM 接入策略不是“只支持某一家”，也不是“假设所有供应商都与 OpenAI 完全等同”，而是：

- **优先兼容 OpenAI 生态**
- **优先统一到 `chat/completions` 能力面**
- **通过 provider preset + capability flags + `extra_body` 处理差异**

v1 正式支持以下中国供应商接入路线：

| 供应商 | 推荐接入方式 | 备注 |
|---|---|---|
| GLM / 智谱 | OpenAI-compatible | 官方提供兼容接口 |
| Qwen / 阿里云百炼 | OpenAI-compatible | 官方兼容层较完整，也可承载第三方模型 |
| MiniMax | OpenAI-compatible | 官方提供 OpenAI-compatible 文档 |
| DeepSeek | OpenAI-compatible | 官方支持直接使用 OpenAI SDK |
| Kimi / Moonshot | OpenAI-compatible | 官方明确兼容 OpenAI API 格式 |

但文档必须明确以下事实：

1. **兼容不等于完全等同**
   不同供应商对最新 OpenAI 全家桶接口的覆盖范围不同，尤其是 `Responses`、`Conversations`、`Batch`、`Files`、`Embeddings` 等能力不应默认假设齐平。
2. **参数层会有供应商差异**
   某些推理、thinking、reasoning、工具调用增强参数可能需要通过 `extra_body` 或 provider-specific 参数传入。
3. **模型名、地域、限流和响应细节不统一**
   即使都能复用 OpenAI SDK，`base_url`、`model`、鉴权环境变量、地域约束、流式响应细节和速率限制仍然是 provider-specific。

因此，Code Brain 在实现上应遵循：

- 默认统一封装 `chat/completions`
- 不把任意一家供应商的私有参数提升为公共 contract
- 允许 provider preset 声明能力差异
- 允许通过 `extra_body` 透传供应商扩展参数
- 当供应商不支持某项增强能力时，自动降级到通用路径

---

## 四、知识模型

### 4.1 页面类型

v1 只保留 5 个顶层页面类型：

| 类型 | 说明 | 存什么 | 旧概念如何收敛 |
|---|---|---|---|
| `issue` | 问题与修复事实 | 症状、根因、修复、回归影响 | 原 `bug-fix` |
| `architecture` | 结构与边界 | 模块职责、数据流、依赖边界、关键接口 | 原 `architecture` + `module` 的上位类型 |
| `decision` | 技术决策 | 决定、候选方案、取舍、后果、回看条件 | 原 `decision` |
| `practice` | 约定与模式 | 推荐做法、反模式、限制、例外 | 原 `pattern` + `pitfall` |
| `change` | 开发过程记录 | 一次有意义的 bugfix/refactor/feature/rollback/recovery | 新增类型 |

分类原则：

- `module` 不再单列类型，模块知识归入 `architecture`
- `pitfall` 不再单列类型，常驻陷阱归入 `practice`
- `pattern` 不再单列类型，规范和推荐模式归入 `practice`
- “开发过程”不再只是附属 timeline，而是正式的 `change` 页面

### 4.2 结构化维度

顶层类型之外，页面还通过结构化维度表达更细语义：

| 字段 | 说明 | 示例 |
|---|---|---|
| `project` | 所属项目 | `kilo-code` |
| `tags` | 自由标签 | `electron`, `sandbox` |
| `aliases` | 同义词、别名、常见查询词 | `contextIsolation`, `preload crash` |
| `scope_refs` | 与代码对象的结构化关联 | repo/module/file/symbol |
| `status` | 页面状态 | `fixed`, `active`, `accepted` |
| `lifecycle_stage` | 所处开发阶段 | `design`, `implementation`, `validation` |
| `change_kind` | 变更类别 | `bugfix`, `refactor`, `feature` |
| `source_type` | 来源类型 | `manual`, `diff`, `commit`, `agent_summary`, `import` |
| `source_agent` | 来源 Agent | `claude-code`, `cursor`, `codex`, `none` |
| `confidence` | 自动提取置信度 | `0.82` |
| `see_also` | 相关页面 slug | `architecture/extension-host-lifecycle` |

推荐枚举：

- `lifecycle_stage`: `discovery | design | implementation | validation | release | maintenance`
- `change_kind`: `bugfix | refactor | feature | rollback | recovery | maintenance`
- `source_type`: `manual | diff | commit | agent_summary | import`
- `source_agent`: `claude-code | cursor | codex | none`

### 4.3 `scope_refs` 结构

`scope_refs` 用来把知识和代码对象真正挂上钩，而不是只靠全文文本提及。

推荐格式：

```yaml
scope_refs:
  - kind: repo
    value: kilo-code
  - kind: module
    value: src/extension-host
  - kind: file
    value: src/main/preload.ts
  - kind: symbol
    value: BootstrapExtensionHost
```

`kind` 的 v1 正式枚举：

- `repo`
- `module`
- `file`
- `symbol`

### 4.4 通用 Frontmatter

所有页面至少包含以下 frontmatter：

```yaml
---
project: kilo-code
type: issue
title: Electron Sandbox Crash
tags:
  - electron
  - sandbox
aliases:
  - contextIsolation crash
  - preload crash
scope_refs:
  - kind: module
    value: src/extension-host
  - kind: file
    value: src/main/preload.ts
status: fixed
source_type: diff
source_agent: cursor
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z

# 以下字段按需出现
lifecycle_stage: validation
change_kind: bugfix
confidence: 0.91
see_also:
  - architecture/extension-host-lifecycle
  - practice/preload-bridge-rule
---
```

说明：

- `project`、`type`、`title`、`tags`、`aliases`、`scope_refs`、`status`、`source_type`、`source_agent`、`created_at`、`updated_at` 是基础字段
- `change_kind` 对 `change` 页面是强烈推荐字段
- `confidence` 仅在自动提取路径下强烈推荐
- `see_also` 是显式链接提示，真正的关系以索引层 link 表为准

### 4.5 Compiled Truth + Timeline 协议

所有页面都遵循统一协议，但 **正文模板因类型而异**：

1. **上层：Compiled Truth**
   当前最佳理解，可被更新、重写、整理
2. **下层：Timeline**
   按时间追加的重要事件，保留证据轨迹

这意味着：

- 所有页面都允许“现在的结论”和“过去发生过什么”并存
- 但不再要求 `issue`、`architecture`、`decision`、`practice`、`change` 五类页面共用同一组标题

### 4.6 各类型正文模板

#### `issue`

推荐章节：

- Symptoms
- Root Cause
- Fix
- Impact
- Validation
- See Also
- Timeline

#### `architecture`

推荐章节：

- Purpose
- Boundaries
- Structure
- Key Flows
- Constraints
- Failure Modes
- See Also
- Timeline

#### `decision`

推荐章节：

- Context
- Decision
- Alternatives Considered
- Trade-offs
- Consequences
- Revisit Trigger
- See Also
- Timeline

#### `practice`

推荐章节：

- Rule
- Why
- Correct Pattern
- Anti-pattern
- Scope
- Exceptions
- See Also
- Timeline

#### `change`

`change` 是 v1 中最关键的新增类型，必须有明确模板：

```markdown
---
project: kilo-code
type: change
title: Refactor preload bridge for sandbox-safe startup
tags:
  - electron
  - preload
  - sandbox
aliases:
  - preload bridge refactor
scope_refs:
  - kind: file
    value: src/main/preload.ts
  - kind: file
    value: src/main/ipc/readFile.ts
status: recorded
source_type: agent_summary
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
lifecycle_stage: validation
change_kind: refactor
confidence: 0.88
see_also:
  - issue/electron-sandbox-crash
  - practice/preload-bridge-rule
---

## Background

此前 preload 仍残留直接访问 Node API 的代码路径，sandbox 模式下有崩溃风险。

## Goal

把 preload 改成只暴露 browser-safe bridge，并把文件读写转移到 main process。

## What Changed

- 移除了 preload 中对 `fs` 的直接引用
- 新增 `contextBridge` 暴露的 `readFile` 接口
- main process 接管文件读取

## Why

确保 sandbox + contextIsolation 组合下启动稳定，并统一 bridge 模式。

## Impact

- 影响 preload 与 extension host 启动链路
- 需要验证 Windows/macOS/Linux 三平台回归

## Linked Knowledge

- `issue/electron-sandbox-crash`
- `practice/preload-bridge-rule`

## Timeline

- 2026-04-18 | extracted | 从任务完成总结自动生成 change 页面
- 2026-04-18 | linked | 关联到 `issue/electron-sandbox-crash`
- 2026-04-18 | validated | 三平台验证通过
```

### 4.7 页面关系

页面之间通过显式关系连接。v1 正式支持：

- `relates_to`
- `updates`
- `implements`
- `evidences`
- `supersedes`

关系约定：

- `change` -> `issue`: 通常是 `updates` 或 `evidences`
- `change` -> `architecture`: 通常是 `updates` 或 `implements`
- `change` -> `decision`: 通常是 `implements`
- `change` -> `practice`: 通常是 `implements` 或 `evidences`

---

## 五、存储与索引

### 5.1 真相源与索引层

v1 明确采用：

- **Markdown 为真相源**
- **SQLite 为索引层**
- **不采用双主写入**

写入原则：

1. 先写 Markdown 文件
2. 写入成功后立即更新 SQLite
3. 如果索引刷新失败，文件依然保留为权威记录
4. `reindex` 可以从 Markdown 全量重建 SQLite

### 5.2 SQLite 逻辑模型

SQLite 是全局索引库，不是业务真相源。推荐逻辑表如下：

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);

CREATE TABLE pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL REFERENCES projects(id),
  slug TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  path TEXT NOT NULL,
  status TEXT NOT NULL,
  lifecycle_stage TEXT,
  change_kind TEXT,
  source_type TEXT NOT NULL,
  source_agent TEXT NOT NULL,
  confidence REAL,
  tags_json TEXT NOT NULL,
  aliases_json TEXT NOT NULL,
  see_also_json TEXT NOT NULL,
  compiled_truth TEXT NOT NULL,
  timeline_text TEXT NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  UNIQUE(project, slug)
);

CREATE TABLE page_scopes (
  page_id INTEGER NOT NULL REFERENCES pages(id),
  kind TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (page_id, kind, value)
);

CREATE TABLE page_links (
  from_page_id INTEGER NOT NULL REFERENCES pages(id),
  to_page_id INTEGER NOT NULL REFERENCES pages(id),
  relation TEXT NOT NULL,
  context TEXT,
  PRIMARY KEY (from_page_id, to_page_id, relation)
);

CREATE TABLE timeline_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id INTEGER NOT NULL REFERENCES pages(id),
  ts TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT
);

CREATE TABLE ingest_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project TEXT NOT NULL REFERENCES projects(id),
  change_page_slug TEXT,
  source_type TEXT NOT NULL,
  source_ref TEXT,
  fingerprint TEXT NOT NULL,
  confidence REAL,
  created_at DATETIME NOT NULL,
  UNIQUE(project, fingerprint)
);

CREATE VIRTUAL TABLE pages_fts USING fts5(
  project,
  slug,
  type,
  title,
  compiled_truth,
  timeline_text,
  aliases,
  tags,
  scope_text
);
```

设计要点：

- `pages.compiled_truth` 只存正文上层可搜索摘要
- `timeline_text` 将时间线拼接为可索引文本
- `page_scopes` 负责结构化过滤
- `path` 保证索引层始终能回到文件系统真相源
- `ingest_events` 负责去重、回溯、重建提取链路

#### 5.2.1 FTS5 tokenizer 与中文分词策略

`pages_fts` 不能直接依赖 SQLite FTS5 的默认中文处理能力。v1 的正式要求是：

1. **英文、路径、符号、slug**
   继续使用 FTS5 处理，适配代码检索场景
2. **中文文本**
   在写入索引前先做分词预处理，再写入 FTS 字段
3. **中英混合内容**
   保留原文，同时额外生成规范化 token 文本用于索引

实现约束：

- 不把“原始中文正文直接喂给 FTS5 默认 tokenizer”视作可接受方案
- TypeScript 路线可选 `nodejieba` 或同类中文分词库
- Python 路线可选 `jieba` 或同类中文分词库
- 最终实现使用哪一个分词库可以后定，但**必须**满足中英混合查询的可用性

索引策略：

- Markdown 原文继续保留在 `pages` 表和文件系统中
- FTS5 存放的是“可搜索文本”，它可以是经过分词和规范化后的索引文本，而不要求与 Markdown 原文逐字一致
- `title / compiled_truth / timeline_text / aliases / tags / scope_text` 都应走同样的规范化流程

### 5.3 Write-through 同步

写入流程固定为：

1. 解析目标项目和目标页面
2. 生成或更新 Markdown
3. 以 `tmp file -> fsync -> rename` 方式原子写入文件
4. 重新解析 Markdown
5. 在 SQLite 事务中更新 `pages / page_scopes / page_links / timeline_entries / pages_fts`
6. 记录本次索引刷新成功
7. 返回最终页面与索引结果

这是 **write-through** 同步，不是：

- 先写 SQLite 再导出 Markdown
- Markdown 与 SQLite 双向实时主写
- 依赖定时任务慢慢补索引

一致性与并发策略：

- SQLite 必须启用 **WAL 模式**
- v1 明确采用 **单进程串行写入队列**
- 同一时刻只允许一个写操作进入“文件写入 + 索引更新”临界区
- 如果进程在“文件已更新但索引未更新”之间崩溃，Markdown 仍然是真相源；启动时或下次 `reindex`/一致性检查时必须自动修复索引漂移

这里需要明确：

- v1 不追求跨文件系统与 SQLite 的“单事务原子提交”
- v1 追求的是“文件真相不丢失 + 索引漂移可检测、可恢复”

### 5.4 重建与漂移修复

`reindex` 用于以下场景：

- 人工直接修改了 brain repo 中的 Markdown
- LLM 提取逻辑升级后需要重建索引
- SQLite 损坏或版本迁移

`reindex` 行为：

- 默认按项目重建
- 可全库重建
- 始终以 Markdown 内容为准覆盖索引层

一致性检查要求：

- v1 应提供启动时的轻量 reconcile，至少检测“文件存在但索引缺失”和“索引存在但文件缺失”
- `reindex` 可以承担最终修复手段
- 后续实现可补充单独的 `consistency_check` / `audit` 能力，但主设计不把它列为必须的独立公开工具

---

## 六、搜索设计

### 6.1 目标

搜索必须同时满足：

- 支持中英混合查询
- 支持报错原文、文件路径、模块名、符号名混合搜索
- 默认按当前项目检索，必要时可跨项目
- 默认优先返回长期知识页，再附带相关 `change` 作为证据
- 在 LLM 不可用时保持基础可用

### 6.2 对外查询接口

v1 对外只有一个正式搜索入口：`search`

| 参数 | 必填 | 说明 |
|---|---|---|
| `query` | 是 | 用户查询文本 |
| `project` | 否 | 显式项目 ID |
| `global` | 否 | 是否跨项目搜索，默认 `false` |
| `types` | 否 | 过滤页面类型数组 |
| `scope_refs` | 否 | 过滤作用域数组 |
| `limit` | 否 | 返回条数，默认 `10` |
| `context_path` | 否 | 用于项目识别的路径上下文 |

默认行为：

- 若 `project` 未传，先按项目识别机制推断
- 若 `global=false`，默认只在当前项目搜索
- 若 `global=true`，结果中必须带项目标识

### 6.3 搜索流水线

默认搜索保留 **单一 `search` 入口**，并采用**质量优先**的主流水线，而不是把用户暴露给 `search` / `smart_search` 两套心智：

1. **项目解析**
   解析 `project` 或 `context_path`
2. **查询规范化**
   保留中文原句，同时提取英文术语、路径、符号、报错短语
3. **LLM 查询理解与扩展（优先）**
   当 LLM 可用时，先生成查询扩展、同义词、候选过滤条件和意图提示
4. **候选召回**
   FTS5 搜索 `title + compiled_truth + timeline_text + aliases + tags + scope_text`，同时利用原始查询与改写查询联合召回
5. **结构化过滤**
   按 `project / types / scope_refs / status` 过滤
6. **类型优先级加权**
   `issue / architecture / decision / practice` 高于 `change`
7. **LLM 重排（优先）**
   当 LLM 可用时，对 top-N 候选按查询相关性、事实稳定性和上下文价值进行重排
8. **结果装配**
   返回知识页结果（`slug / type / title / summary / related_changes` 等），并附带高相关 `change` 作为证据上下文；调用方若需完整正文，再通过 `get_page` 读取 Markdown 真相源对应页面

内部策略要求：

- 当 LLM 可用时，查询理解与扩展、重排属于默认主链路，而不是仅作锦上添花
- FTS5 负责稳定召回，LLM 负责默认排序质量和意图理解
- 当 LLM 超时或不可用时，才退化为本地候选排序结果

这里需要明确：

- `search` 返回的是**知识页结果**，不是 Code Brain 额外生成的一段不可追溯答案
- Agent 先看到的是候选知识页的摘要与关联信息，再按需调用 `get_page`
- 这样可以保证可追溯、可审计、可回到 Markdown 真相源

### 6.4 排序规则

默认排序综合考虑：

1. 当前项目命中优先于跨项目命中
2. 长期知识页优先于过程记录
3. 精确 `scope_refs` 匹配优先于纯文本匹配
4. `aliases` 命中优先于普通正文命中
5. `validated/fixed/accepted/active` 等稳定状态优先于低置信度记录
6. `change` 页主要作为证据和上下文补充，而不是默认第一结果

### 6.5 降级策略

LLM 不可用、超时或网络异常时：

- `search` 不能失败
- 自动退化为本地 `FTS5 + 中文分词索引 + 结构化过滤 + 类型加权`
- 返回结果中标记“未启用智能重排”

### 6.6 性能目标

v1 目标性能如下：

| 场景 | 目标 |
|---|---|
| 智能搜索端到端 | 常态 3-8 秒 |
| 纯本地降级搜索 | 1 秒级 |
| write-through 索引刷新 | 单页写入后 1 秒内可搜到 |
| 全库 reindex | 以正确性优先，速度次之 |

性能策略说明：

- Agent 默认调用的仍然是同一个 `search`
- 默认接受搜索链路为了质量而引入额外 LLM 延迟
- 只有在 LLM 不可用、超时或网络异常时，才以本地降级搜索维持基础可用

### 6.7 Embedding 的位置

embedding 不是 v1 前提。未来如果知识量或召回质量需要，可以追加为可选优化层，但不改变以下事实：

- Markdown 仍是真相源
- SQLite 仍是基础检索层
- `search` 仍是唯一正式搜索入口

---

## 七、知识写入与自动提取

### 7.1 v1 正式输入来源

v1 只接受以下正式输入：

- `git diff`
- `commit message`
- `Agent 显式总结`

v1 不直接摄入：

- 完整聊天记录
- 会议纪要
- 邮件、日历、网页文章

### 7.2 默认触发点

自动写入的默认触发点是：

1. **任务完成边界**
   一个稳定工作单元结束，例如某次 bugfix、重构、功能开发或恢复任务已被调用方判定完成
2. **commit 边界**
   一个有意义的提交形成稳定变更单元

不采用“每有一点 diff 就立刻记一次”的默认策略，因为那会产生大量碎片化记录。

这里的“任务完成”不是由 Code Brain 从代码状态自动推断，而是由调用方语义决定。典型完成信号包括：

- Agent 生成了明确的最终总结
- 用户确认“这个问题已经解决”或“这轮重构已经完成”
- 形成一次有意义的 commit
- 调用方决定当前工作单元已经达到可沉淀状态

### 7.3 核心写入原则

v1 的主链路不是直接创建长期知识页，而是：

1. **先创建或更新 `change`**
2. **再按需更新 `issue / architecture / decision / practice`**
3. **建立显式链接**
4. **刷新索引**

这保证开发过程和长期事实同时沉淀，且彼此关联。

### 7.4 `record_change` 标准流程

`record_change` 是 v1 最关键的写入入口。默认流程：

1. 解析 `project`
2. 读取 `diff / commit message / agent summary`
3. 提取 `change_kind`、`scope_refs`、`title`、`summary`
4. 计算 `fingerprint`
5. 若命中同一变更源，则更新已有 `change`
6. 若未命中，则创建新 `change`
7. 判断是否需要 upsert 长期知识页
8. 自动建立 `change -> long-lived page` 链接
9. 记录 `ingest_events`
10. write-through 更新 SQLite

输入约束：

- `diff / commit_message / agent_summary` 三者至少提供一项
- 若三者都缺失，`record_change` 必须返回参数错误，而不是创建空壳 `change`

调用建议：

- Agent 应优先显式传入 `project`
- Agent 在能判断意图时，应显式传入 `related_types` 或同类提示字段
- 系统自动判断是增强能力，不应拒绝 Agent 主动提供结构化意图

### 7.5 自动 upsert 长期知识的规则

这里必须区分两种模式：

#### 7.5.1 规则模式（LLM 不可用时）

默认行为：

- 一定创建或更新 `change`
- 只做**保守关联**，不做高风险语义生成
- 满足明确 heuristic 时，可以创建 link 或生成长期知识候选
- 不满足 heuristic 时，只保留 `change`

规则模式的最小 heuristic：

1. **Issue 候选**
   若 `commit_message` 或 `agent_summary` 明确包含 `fix / bug / hotfix / regression` 等信号，优先关联或候选更新 `issue`
2. **Architecture 候选**
   若本次变更涉及的 `scope_refs` 与已有 `architecture` 页面的 `scope_refs` 有显著交集，优先建立 `updates` 或 `evidences` link
3. **Decision 候选**
   若 `agent_summary` 明确包含“选择/弃用/改用/迁移到”等决策信号，才候选更新 `decision`
4. **Practice 候选**
   若 `agent_summary` 明确给出“规则/限制/正确做法/反模式”表达，才候选更新 `practice`

规则模式下的默认优先级是：

- **先 link，再 upsert**
- 若系统无法稳定判断，则宁可只保留 `change`，也不盲目写坏长期知识

#### 7.5.2 LLM 模式（LLM 可用时）

LLM 模式允许做更强的语义判断，但也必须受控：

- LLM 的职责是“从 `diff / commit_message / agent_summary` 中提炼稳定事实”
- LLM 不应凭空生成文档中不存在的架构结论
- LLM 输出必须是结构化结果，再由系统按规则决定 `create / update / link / ignore`

LLM 模式下的推荐判断：

- **生成 `issue`**
  当变更明确对应某个问题、根因和修复事实
- **更新 `architecture`**
  当变更改变模块边界、关键结构、依赖关系或主流程
- **更新 `decision`**
  当变更体现出正式技术选型、取舍或重大的方向性判断
- **更新 `practice`**
  当变更形成可复用的规则、反模式或编码约束

#### 7.5.3 Agent 显式提示

当调用方已经知道本次变更更接近哪一类知识时，允许显式提供：

- `related_types`
- `scope_refs`
- `source_ref`

系统应把这些提示视为高优先级输入，但仍保留基本校验。

### 7.6 去重与更新策略

去重策略分两层：

1. **`change` 去重**
   优先依据 `fingerprint`，由 `project + source_ref + change_kind + primary scope_refs` 组成
2. **长期知识去重**
   先按 `type + project + primary scope_refs` 找候选，再用 LLM 或规则判断是更新还是新建

目标不是零重复，而是：

- 避免无限创建内容相近的长期知识页
- 允许不同时间段的 `change` 记录持续累积

关键字段定义：

- `source_ref`
  - `source_type=commit` 时，优先使用 commit hash
  - `source_type=diff` 时，使用规范化 diff 的内容 hash
  - `source_type=agent_summary` 时，使用调用方传入的 task/session reference；若无，则由摘要文本哈希生成
  - `source_type=manual` 时，可为空，此时不能单独作为精确去重依据
- `primary_scope_refs`
  - 指经过规范化排序后，最能代表本次变更主落点的前 1-3 个 scope ref
  - 优先级默认 `symbol > file > module > repo`
  - 若没有更细粒度作用域，则退化到 `module` 或 `repo`

`fingerprint` 的正式计算规则：

```text
SHA256(
  project
  + source_type
  + normalized_source_ref
  + change_kind
  + normalized_primary_scope_refs
)
```

去重要求：

- `fingerprint` 负责**精确去重**
- 长期知识更新判断负责**近似去重**
- 即使 `fingerprint` 不同，只要命中同一长期知识候选，仍应优先更新而不是盲目新建

### 7.7 置信度与人工复核

默认策略是 **直接写入**，不是先全部进入草稿箱。

同时必须记录：

- `source_type`
- `source_agent`
- `confidence`
- `ingest_event`

低置信度内容处理：

- 页面仍然写入
- `status` 标记为 `needs_review` 或对应类型的低稳定状态
- 搜索排序时低于稳定页面

---

## 八、公开接口设计

### 8.1 MCP 工具

v1 对外只暴露少量稳定工具：

| 工具名 | 作用 | 关键参数 |
|---|---|---|
| `search` | 搜索知识 | `query`, `project?`, `global?`, `types?`, `scope_refs?`, `limit?`, `context_path?` |
| `get_page` | 获取单页 | `slug`, `project?` |
| `list_pages` | 列表查询 | `project?`, `types?`, `status?`, `tags?`, `limit?` |
| `upsert_page` | 创建或更新长期知识页 | `project?`, `type`, `slug?`, `title`, `content`, `tags?`, `aliases?`, `scope_refs?`, `status?`, `see_also?`, `context_path?` |
| `record_change` | 记录一次有意义变更 | `project?`, `title?`, `change_kind?`, `diff?`, `commit_message?`, `agent_summary?`, `scope_refs?`, `related_types?`, `source_ref?`, `source_agent?`, `context_path?` |
| `link_pages` | 建立关系 | `project`, `from_slug`, `to_slug`, `relation`, `context?` |
| `get_links` | 查询关系 | `project`, `slug`, `direction?` |
| `reindex` | 从 Markdown 重建索引 | `project?`, `full?` |

接口设计原则：

- 不单独暴露 `smart_search`
- 不单独暴露 `extract_from_diff`
- 是否使用 LLM 由服务内部和配置决定

### 8.2 CLI 命令

CLI 与 MCP 共享同一套 operations：

```bash
code-brain serve
code-brain search "electron sandbox crash" --project kilo-code
code-brain get issue/electron-sandbox-crash --project kilo-code
code-brain list --project kilo-code --types issue,practice
code-brain upsert --project kilo-code --type practice --title "Preload Bridge Rule"
code-brain change record --project kilo-code --kind bugfix --summary-file ./summary.md
code-brain link --project kilo-code --from change/2026-04-18-preload-bridge --to issue/electron-sandbox-crash --relation updates
code-brain reindex --project kilo-code
code-brain project register --id kilo-code --root ~/work/kilo-code --remote github.com/your-org/kilo-code
code-brain project list
```

CLI 的正式职责：

- 配置与项目注册
- 脚本化写入
- 批处理与调试
- 在某些 Agent 环境下作为 MCP 的补位

CLI/MCP 一致性要求：

- CLI 与 MCP 必须复用同一套 operations 和校验逻辑
- 如 `--summary-file` 这类 CLI 便捷参数，最终都应映射到与 MCP 相同的 `agent_summary` 语义
- 不能出现“CLI 能做但 MCP 不能做”或反之的行为分裂

### 8.3 配置文件

最小配置示例：

```yaml
# ~/.code-brain/config.yaml

brain:
  repo: ~/.code-brain/brain-repo
  index_db: ~/.code-brain/index.db

projects:
  - id: kilo-code
    roots:
      - ~/work/kilo-code

llm:
  enabled: true
  api:
    mode: openai-compatible
    base_url: https://api.example.com/v1
    api_key_env: LLM_API_KEY
    default_model: model-default
```

高级配置示例：

```yaml
# ~/.code-brain/config.yaml

brain:
  repo: ~/.code-brain/brain-repo
  index_db: ~/.code-brain/index.db

projects:
  - id: kilo-code
    title: Kilo Code
    roots:
      - ~/work/kilo-code
    git_remotes:
      - github.com/your-org/kilo-code

llm:
  enabled: true
  provider: deepseek
  api:
    mode: openai-compatible
    base_url: https://api.example.com/v1
    api_key_env: LLM_API_KEY
    default_model: model-default
  models:
    search:
      model: model-search
    extract:
      model: model-extract
    dedup:
      model: model-dedup
  providers:
    zhipu:
      mode: openai-compatible
      base_url: https://open.bigmodel.cn/api/paas/v4/
      api_key_env: ZAI_API_KEY
      default_model: glm-default
      capabilities:
        chat_completions: true
        tool_calling: true
        reasoning_control: true
    qwen_bailian:
      mode: openai-compatible
      base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
      api_key_env: DASHSCOPE_API_KEY
      default_model: qwen-default
      capabilities:
        chat_completions: true
        tool_calling: true
        vision: true
    minimax:
      mode: openai-compatible
      base_url: https://api.minimax.io/v1
      api_key_env: MINIMAX_API_KEY
      default_model: minimax-default
      capabilities:
        chat_completions: true
        tool_calling: true
        reasoning_control: true
    deepseek:
      mode: openai-compatible
      base_url: https://api.deepseek.com
      api_key_env: DEEPSEEK_API_KEY
      default_model: deepseek-default
      capabilities:
        chat_completions: true
        tool_calling: true
        reasoning_control: true
    kimi:
      mode: openai-compatible
      base_url: https://api.moonshot.cn/v1
      api_key_env: MOONSHOT_API_KEY
      default_model: kimi-default
      capabilities:
        chat_completions: true
        tool_calling: true
        reasoning_control: true
  routing:
    search: deepseek
    extract: kimi
    dedup: qwen_bailian
  request:
    extra_body: {}
  timeout_ms: 8000
  retries: 2

mcp:
  name: code-brain
  version: 0.2.0
```

配置原则：

- 必须支持 **provider preset**
- 必须支持 **全局模型**
- 可以按能力覆盖 `search / extract / dedup`
- 必须允许声明 capability flags，例如 `chat_completions`、`tool_calling`、`vision`、`reasoning_control`
- 必须允许通过 `extra_body` 透传供应商扩展参数
- 必须支持超时、重试、总开关
- 示例里的模型名只表示能力位点，不绑定具体厂商型号
- 最小配置必须足以让单 provider 用户快速启动
- 多 provider routing 应视为高级能力，而不是默认门槛

---

## 九、Agent 集成方式

### 9.1 通用规则模板

四类 Agent 共用的最小规则：

1. 在执行非 trivial 代码修改前，先 `search`
2. 在完成有意义的 bugfix/refactor/feature/recovery 后，调用 `record_change`
3. 当发现稳定事实时，调用 `upsert_page` 更新 `issue / architecture / decision / practice`
4. 调用时优先传 `project` 或 `context_path`

### 9.2 Claude Code

首选 MCP 配置：

```json
{
  "mcpServers": {
    "code-brain": {
      "command": "code-brain",
      "args": ["serve"]
    }
  }
}
```

`CLAUDE.md` 中建议加入：

```markdown
## Code Brain

- 在非 trivial 修改前先搜索当前项目知识
- 任务完成后调用 `record_change`
- 涉及架构、规则、决策或问题事实变化时，更新长期知识页
- 调用工具时优先传当前项目或仓库路径
```

### 9.3 Cursor

首选 MCP 配置，配合规则文件：

```json
{
  "code-brain": {
    "command": "code-brain",
    "args": ["serve"]
  }
}
```

`.cursor/rules/code-brain.mdc` 中建议加入同样的触发规则。

### 9.4 Codex

正式口径是 **MCP 优先，CLI 补位**：

- 若当前 Codex 环境支持 MCP，则与 Claude Code、Cursor 共用同一服务
- 若当前环境以 CLI 为主，则通过 `code-brain` 命令访问相同 operations

也就是说，Codex 不再被定义为“CLI-only”的特例，而是：

- **首选 MCP**
- **当前环境不便时允许 CLI 补位**

### 9.5 Gemini CLI

v1 对 Gemini CLI 的正式支持等级是 **实验性 CLI 支持**。

正式口径是 **CLI 优先**：

- 默认通过 `code-brain` CLI 访问相同 operations
- 若后续运行环境支持 MCP 或等价工具桥接，可复用同一 `code-brain serve`

也就是说，Gemini CLI 在 v1 中的支持目标是：

- **先保证 CLI 路径稳定可用**
- **不排斥后续复用 MCP 接入**

v1 的可实施接入模板至少应覆盖：

```bash
code-brain search "query" --context-path "$(pwd)"
code-brain change record --context-path "$(pwd)" --summary-file ./summary.md
```

验收口径：

- v1 不要求 Gemini CLI 与 Claude Code 拥有完全相同的 MCP 集成体验
- v1 要求 Gemini CLI 至少能稳定走 CLI 路径完成“搜索 -> 修改 -> 记录 change”闭环

---

## 十、测试与验收

### 10.1 核心测试场景

1. **项目自动识别**
   在不同 cwd、不同 git remote、显式覆盖参数下都能命中正确项目
2. **write-through 同步**
   Markdown 写入后，SQLite 立刻可搜索；手工改 Markdown 后 `reindex` 结果一致
3. **自动提取主链路**
   一次 bugfix/refactor 完成后，先生成 `change`，再正确更新或关联长期知识页
4. **混合语言搜索**
   中文问题 + 英文模块名 + 报错原文能命中正确结果
5. **跨项目边界**
   默认只搜当前项目；全局搜索可召回其他项目并带项目标识
6. **LLM 降级**
   LLM 不可用、超时或网络异常时，`search` 仍可用
7. **去重与更新**
   相近变更不会无限制造重复长期知识页
8. **四类 Agent 集成**
   Claude Code、Cursor、Codex、Gemini CLI 都能完成“先搜再改、完成后记录”的闭环

### 10.2 推荐测试分层

- **单元测试**
  - slug/path 规则
  - project resolution
  - markdown parser
  - scope_refs normalization
  - link extraction
- **集成测试**
  - write-through
  - reindex
  - search fallback
  - record_change -> upsert long-lived pages
- **端到端测试**
  - Agent A 写入 -> Agent B 搜索到
  - 手工改 Markdown -> reindex -> 搜索结果更新

### 10.3 验收指标

| 指标 | 目标 |
|---|---|
| 智能搜索端到端 | 常态 3-8 秒 |
| 本地降级搜索 | 1 秒级 |
| 索引新鲜度 | 写入后 1 秒内可检索 |
| 注册项目解析准确率 | 对已注册项目应为 100% |
| `reindex` 一致性 | 以 Markdown 为准，重建后结果不漂移 |

---

## 十一、开发计划

### 11.1 阶段推进方式

本设计稿的开发计划只定义 **阶段、交付物和完成判据**，不承诺具体工作日或人日。

原因很简单：

- 这是一个适合 AI 辅助快速开发的项目
- 实际推进速度会强依赖实现栈、Agent 协作方式和自动化程度
- 比起估算时长，先锁定能力块和验收结果更重要

#### Phase 1：基础骨架

目标：

- 建立可运行的本地单进程 `code-brain serve`
- 打通配置加载、项目注册和 SQLite 初始化

交付物：

- 服务入口
- 配置系统
- 项目注册表
- SQLite schema 与基础索引能力

完成判据：

- 服务能启动
- 能加载配置并识别已注册项目
- SQLite 索引库可初始化和重建

#### Phase 2：知识模型与同步

目标：

- 把 Markdown 页面模型与 SQLite 索引层真正接起来

交付物：

- 五类页面 frontmatter 解析
- slug/path 规则
- write-through 同步
- `reindex` 全量重建

完成判据：

- 页面写入后可立即检索
- 手工修改 Markdown 后可通过 `reindex` 恢复一致性

#### Phase 3：搜索与项目解析

目标：

- 建立默认可用的搜索主链路和项目边界

交付物：

- `search / get_page / list_pages`
- 项目自动识别
- 当前项目优先、全局搜索补充
- 类型优先级与结构化过滤

完成判据：

- 当前项目下的查询不需要总是手动传 `project`
- 搜索能区分长期知识页与 `change` 页的默认优先级

#### Phase 4：自动提取与写入

目标：

- 建立 `record_change -> upsert 长期知识 -> link -> 索引刷新` 主链路

交付物：

- `record_change`
- diff/commit/Agent summary 提取
- 长期知识 upsert
- 去重与 link 建立

完成判据：

- 一次有意义的 bugfix/refactor 完成后，能稳定生成 `change`
- 合适时能自动更新 `issue / architecture / decision / practice`

#### Phase 5：Agent 集成与测试

目标：

- 把四类 Agent 的接入、规则模板和回归验证补齐

交付物：

- Claude Code / Cursor / Codex / Gemini CLI 集成模板
- 单元、集成、端到端测试
- 错误处理与降级策略验证

完成判据：

- 四类 Agent 都能完成“先搜再改、完成后记录”的闭环
- LLM 不可用时，基础搜索和索引链路仍可工作

### 11.2 计划口径说明

本章节描述的是 **能力块推进顺序**，不是工期承诺。

如果后续由 AI 主导实现，实际节奏可能明显快于传统人力估算；但无论速度如何，验收仍以每个阶段的交付物和完成判据为准。

---

## 十二、风险与假设

### 12.1 主要风险

| 风险 | 影响 | 应对 |
|---|---|---|
| LLM 搜索链路偏慢 | 搜索体验抖动 | 默认允许降级到本地 FTS5 |
| 自动提取噪音过大 | 知识库污染 | 记录 `confidence`、来源与 `needs_review` 状态 |
| 项目识别错误 | 搜错项目、写错项目 | 显式 `project` 覆盖优先，配置注册表必须可审查 |
| Markdown 与索引漂移 | 搜索结果不可信 | `write-through` + `reindex` 兜底 |
| 长期知识页重复增长 | 知识碎片化 | `record_change` 先沉淀过程，再基于作用域与语义做 upsert |

### 12.2 产品假设

以下假设已在本设计中锁定：

- v1 仍是单用户产品，不做权限、多用户协作、Web UI、云端托管
- v1 只正式适配 Claude Code / Cursor / Codex / Gemini CLI
- v1 不以 embedding 为依赖，embedding 仅作为未来可选优化位
- 默认采用集中脑库仓库 + 单全局 SQLite 索引库
- 默认搜索体验以质量优先为准，接受 LLM 查询改写与重排作为主链路

### 12.3 结论

Code Brain 的 v1 不是“再做一个记笔记工具”，而是把以下三件事做成一个稳定系统：

1. **把代码知识写成可长期维护的 Markdown**
2. **把多项目知识用 SQLite 高质量检索起来**
3. **把 Agent 的开发过程自动沉淀成可回溯、可复用的 change -> long-lived knowledge 链路**

这也是它区别于规则文件、传统 wiki、通用记忆层和 GBrain 的核心价值。
