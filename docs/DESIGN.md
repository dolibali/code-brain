# BrainCode — 跨 Agent 代码知识脑库 MCP Server

> **版本：** v0.2-spec  
> **日期：** 2026-04-18  
> **作者：** zhangrich  
> **状态：** 可实施设计稿

---

## 一、产品定义

### 1.1 一句话定位

**BrainCode 是一个面向重度 AI 编程者的多项目代码知识脑库：让 Claude Code、Cursor、Codex、Gemini CLI 共享同一套代码事实、开发过程和决策上下文。**

它不是通用个人知识库，也不是单一 Agent 的提示词文件集合，而是一个：

- **以 Markdown 为真相源** 的脑库仓库
- **以 SQLite 为全局索引层** 的本地检索系统
- **以 MCP 为首选接入方式**、CLI 为补位的跨 Agent 薄服务
- **以代码知识为核心模型** 的知识库，而不是通用实体图谱

### 1.2 目标用户

v1 面向以下用户画像：

- 会在同一代码库里频繁切换多个 AI Agent
- 日常开发中既要查 bug 修复，也要查架构、约定和历史决策
- 希望知识能直接进 git、可读、可改、可审计
- 不想维护额外数据库服务，也不想把产品建立在 embedding 必需之上

v1 仍然以 **单用户使用** 为前提，但从第一天起按 **可复用的通用产品** 设计，而不是只为某一个项目或某一种个人工作流写死。

### 1.3 典型问题

BrainCode 主要解决以下问题：

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

BrainCode 的 v1 成功标准不是“能存几篇文档”，而是以下闭环能稳定工作：

1. Agent 在做非 trivial 修改前，能先查到当前项目相关知识。
2. 一次有意义的任务完成后，Agent 能显式触发记忆整理流程，并先写入一条 `change` 页面。
3. Agent 能基于同一套薄服务接口更新或关联 `issue / architecture / decision / practice` 页面。
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
| 服务端直接理解 diff/commit 并生成知识 | 这些只是 Agent 整理记忆时可参考的原始材料，不是核心服务接口 |
| embedding 必需 | 可作为未来优化位，但不是 v1 前提 |

---

## 二、设计原则

### 2.1 受 GBrain 启发，但不照搬

BrainCode 借鉴 GBrain 的三点思想：

1. **Compiled Truth + Timeline**
   页面上层是当前最佳理解，下层是时间线证据。
2. **Repo/Human First**
   人类可直接读写 Markdown，系统始终可以从文件重建索引。
3. **稳定操作面**
   对外暴露稳定工具；增强能力由服务内部或 Agent 规则决定，而不是暴露两套心智。

BrainCode 不照搬 GBrain 的部分：

- 不以个人知识管理为建模对象
- 不以向量搜索为核心前提
- 不把技能体系当主要产品表面
- 不把 Postgres/Supabase 当默认依赖

### 2.2 核心原则

1. **Markdown 必选，SQLite 必选，LLM 增强可选**
   Markdown 是真相源；SQLite 是索引和查询层；LLM 只用于搜索体验增强。
2. **MCP 优先，CLI 补位**
   所有正式能力都以 MCP 为主接口；CLI 用于调试、批处理、无 MCP 场景和脚本化接入。
3. **少类型，多维度**
   顶层页面类型保持稳定，复杂语义通过结构化维度表达，而不是不断膨胀类型数。
4. **质量优先的搜索**
   默认允许 LLM 参与查询理解和重排；若失败，再回落到本地 FTS5。
5. **Agent 提供判断，BrainCode 提供持久化、检索与索引**
   知识提炼、页面重写、更新哪一页由 Agent 决定；服务只负责存取与索引原语。
6. **开发过程也是一等知识**
   不是只记录“结论”，还要记录“发生过什么变更、为什么这样变”。
7. **中央脑库，项目隔离**
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
	                │    BrainCode     │
	                │                   │
	                │  Project Resolver │  -> 识别当前项目
	                │  Search Engine    │  -> FTS5 + LLM 增强
	                │  Page Store       │  -> get/list/put/link
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
| LLM 增强层 | 可选 | 查询理解与扩展、结果重排 |

### 3.3 默认部署模型

默认部署是：

- 一个本地运行的 `braincode serve`
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

BrainCode 默认按以下优先级识别当前项目：

1. **Agent 显式传入 `project`**
   这是首选路径，也是最可靠的项目解析方式
2. **Agent 或调用方传入 `context_path`**
   由 BrainCode 根据路径进一步推断项目
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

- **Agent 明确告诉 BrainCode 当前项目，优先于 BrainCode 自行猜测**
- 自动项目识别是兜底能力，不是主交互模式
- `project id/name + git_remotes + main_branch` 是跨机器稳定项目身份
- `roots` 只是本机挂载点，用于 cwd/context 解析；远程服务端可以保存 `roots: []`
- Markdown frontmatter、`scope_refs`、sync manifest 不应保存机器绝对路径
- 已注册项目应记录 `main_branch`，供 Agent recipe 和外部同步流程参考
- 非 `main_branch` 的开发分支默认只搜索和读页，这是一条 workflow 建议，不是服务端写入校验

### 3.6 推荐实现基线

虽然语言和中间件尚未最终拍板，但 v1 的**推荐实现基线**已经明确：

- **单进程本地服务**
- **同一进程内完成项目解析、索引、搜索、页面存取和同步**
- **通过模块边界分层，而不是一开始拆成多服务或独立 worker**

推荐这样做的原因：

- 更贴合单用户、本地优先、SQLite 嵌入式的产品前提
- 更适合 AI 辅助快速迭代
- 更容易把 `search / put_page / reindex` 做成一致的 contract
- 出现问题时更容易调试和重建

v1 **不默认采用** 以下架构作为起点：

- 插件化 engine/provider 内核
- 搜索服务、同步服务、页面存取服务的多进程拆分
- 远程数据库或云端任务队列

这些能力可以在后续规模化阶段演进，但不是 v1 的默认复杂度。

MCP transport 约定：

- 本地模式默认采用 `stdio` 作为 MCP transport
- 远程模式采用 Streamable HTTP MCP，固定路径为 `/mcp`
- 远程模式仍然保持薄服务工具面，不增加自动记忆整理工具
- 远程 HTTP 服务必须使用 Bearer token 鉴权；公网部署必须放在 HTTPS/TLS 环境后

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

BrainCode 的 LLM 接入策略不是“只支持某一家”，也不是“假设所有供应商都与 OpenAI 完全等同”，而是：

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

因此，BrainCode 在实现上应遵循：

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
| `source_type` | 页面写入来源 | `manual`, `agent`, `import` |
| `source_agent` | 来源 Agent | `claude-code`, `cursor`, `codex`, `gemini-cli`, `none` |
| `see_also` | 相关页面 slug | `architecture/extension-host-lifecycle` |

推荐枚举：

- `lifecycle_stage`: `discovery | design | implementation | validation | release | maintenance`
- `change_kind`: `bugfix | refactor | feature | rollback | recovery | maintenance`
- `source_type`: `manual | agent | import`
- `source_agent`: `claude-code | cursor | codex | gemini-cli | none`

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

推荐基础 frontmatter 如下：

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
source_type: agent
source_agent: cursor
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z

# 以下字段按需出现
lifecycle_stage: validation
change_kind: bugfix
see_also:
  - architecture/extension-host-lifecycle
  - practice/preload-bridge-rule
---
```

说明：

- `put_page` 的 `slug` 参数是权威写入目标；frontmatter 中可省略 `slug`，若显式提供，必须与工具参数一致
- frontmatter 必填字段为：`project`、`type`、`title`、`status`、`source_type`、`source_agent`、`created_at`、`updated_at`
- 常见但可选字段为：`tags`、`aliases`、`scope_refs`、`lifecycle_stage`、`change_kind`、`see_also`
- `type` 枚举固定为：`issue | architecture | decision | practice | change`
- `source_type` 枚举固定为：`manual | agent | import`
- `status` 推荐按类型约束：
  - `issue`: `open | investigating | fixed | wont_fix | needs_review`
  - `architecture`: `current | proposed | deprecated | needs_review`
  - `decision`: `proposed | accepted | superseded | needs_review`
  - `practice`: `active | deprecated | needs_review`
  - `change`: `recorded | validated | reverted`
- `change_kind` 对 `change` 页面是强烈推荐字段
- `source_type` 描述的是“这一页是由谁写入服务的”，不是底层证据来自哪一种原始材料
- `see_also` 只是人类可读的便利字段；`put_page` 不会自动把它同步为 `page_links`，正式关系仅通过 `link_pages` 建立

### 4.5 Compiled Truth + Timeline 协议

所有页面都遵循统一协议，但 **正文模板因类型而异**：

1. **上层：Compiled Truth**
   当前最佳理解，可被更新、重写、整理
2. **下层：Timeline**
   按时间追加的重要事件，保留证据轨迹

这意味着：

- 所有页面都允许“现在的结论”和“过去发生过什么”并存
- 但不再要求 `issue`、`architecture`、`decision`、`practice`、`change` 五类页面共用同一组标题
- 正文以首个 `## Timeline` 标题作为分界：之前的内容视为 `compiled_truth`，之后的内容视为 `timeline_text`
- 若正文中没有 `## Timeline` 标题，则整篇正文都视为 `compiled_truth`，`timeline_text` 为空

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
source_type: agent
source_agent: codex
created_at: 2026-04-18T10:15:00Z
updated_at: 2026-04-18T10:20:00Z
lifecycle_stage: validation
change_kind: refactor
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

- 2026-04-18 | drafted | Agent 根据本次任务整理并写入 change 页面
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

补充说明：

- `see_also` 仅作为页面内的人类阅读提示
- `page_links` 才是正式关系真相源
- `put_page` 不会自动把 `see_also` 转换为 `page_links`

### 4.8 slug 规则

v1 统一采用稳定、可预测的 slug 规则：

- slug 只允许使用 `[a-z0-9-]`
- slug 不允许中文、大写字母、空格或下划线
- 长期知识页的正式格式为：`<type>/<slug>`
- `change` 页的正式格式为：`change/<year>/<yyyy-mm-dd>-<slug>`
- 中文标题对应的 slug 由 Agent 主动给出英文或英文短语，服务端不做自动翻译
- 若目标 slug 已存在，`put_page` 的语义就是覆盖更新，不会自动创建变体 slug
- `change` 页的 slug 与文件路径保持一致，例如：`change/2026/2026-04-18-preload-bridge-refactor`

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
- `page_links` 只存显式关系，由 `link_pages` 单独维护

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
5. 在 SQLite 事务中更新 `pages / page_scopes / timeline_entries / pages_fts`
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
- 搜索归一化或分词逻辑升级后需要重建索引
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
   返回知识页结果（`slug / type / title / summary / related_changes` 等），其中 `related_changes` 优先来自显式 link 图；调用方若需完整正文，再通过 `get_page` 读取 Markdown 真相源对应页面

内部策略要求：

- 当 LLM 可用时，查询理解与扩展、重排属于默认主链路，而不是仅作锦上添花
- FTS5 负责稳定召回，LLM 负责默认排序质量和意图理解
- 当 LLM 超时或不可用时，才退化为本地候选排序结果

这里需要明确：

- `search` 返回的是**知识页结果**，不是 BrainCode 额外生成的一段不可追溯答案
- Agent 先看到的是候选知识页的摘要与关联信息，再按需调用 `get_page`
- 这样可以保证可追溯、可审计、可回到 Markdown 真相源

### 6.4 排序规则

默认排序综合考虑：

1. 当前项目命中优先于跨项目命中
2. 长期知识页优先于过程记录
3. 精确 `scope_refs` 匹配优先于纯文本匹配
4. `aliases` 命中优先于普通正文命中
5. `validated/fixed/accepted/active` 等稳定状态优先于 `recorded/draft` 等较弱状态
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

## 七、知识写入与 Agent 整理协议

### 7.1 职责分工

BrainCode v1 在写入链路上的正式边界是：

- **Agent 负责判断**
  决定要写什么知识、更新哪一页、是否新建 slug、如何重写 `Compiled Truth`、是否补充 `Timeline`
- **BrainCode 负责持久化**
  负责项目解析、基本校验、Markdown 落盘、SQLite 索引刷新、显式关系存取和 `reindex`

这意味着 BrainCode 核心服务**不负责**：

- 从 `diff / commit / Agent summary` 自动生成页面
- 自动判断“更新已有长期知识页还是新建页”
- 自动执行语义近似去重
- 自动检测冲突并修复知识
- 自动执行 commit 批量补录或结构扫描

另外需要明确：

- v1 中 LLM 在服务端的唯一使用位点是 `search` 链路中的查询理解、扩展与结果重排
- 除此之外，服务端不调用 LLM 做任何写入侧判断

### 7.2 正式写入入口

v1 核心服务只保留两个正式写入原语：

1. **`put_page`**
   写入或覆盖单个完整页面，输入是完整 Markdown + frontmatter
2. **`link_pages`**
   建立页面之间的显式关系

补充说明：

- `search / get_page / list_pages` 是读路径
- `reindex` 是恢复与重建路径
- `diff / commit / Agent summary` 只是 Agent 整理记忆时可参考的原始材料，不是 BrainCode 核心服务接口

### 7.3 默认触发点

知识整理不是服务端后台行为，而是 **Agent 显式触发的 workflow**。

推荐触发时机：

1. **主分支上的任务完成边界**
   一次有意义的 bugfix、refactor、feature、recovery 已完成，且结果已落在项目 `main_branch`
2. **主分支上的 commit 边界**
   已形成稳定提交，适合作为证据和时间线节点
3. **交接边界**
   准备结束当前 session，或准备把任务交给另一个 Agent，且相关改动已经落在主分支
4. **用户显式要求**
   例如“整理这次任务的项目记忆”，且整理依据来自主分支当前状态

这里需要明确：

- BrainCode 不从代码状态自动推断“任务已完成”
- BrainCode 不在后台自行触发整理流程
- commit 可以成为 Agent 的整理依据，但不是服务端自动 ingest 入口
- 默认 recipe 建议只把 `main_branch` 上已经成立的事实写入共享记忆
- Agent 在非主分支开发时，默认只执行 `search / get_page / list_pages`
- 以上分支边界属于 Agent workflow 约定，不属于服务端 `put_page` / `link_pages` 的拒绝条件

### 7.4 统一 Agent 记忆整理 Recipe

四类 Agent 的共同主流程是一个显式 recipe，推荐统一命名为：

- **`brain_sync_task`**
- 中文可理解为：**“整理这次任务的项目记忆”**

推荐步骤：

1. 先确认当前仓库分支是否等于项目配置中的 `main_branch`
2. 若不在 `main_branch`，则只执行 `search / get_page / list_pages`，并推迟共享记忆写入
3. 若在 `main_branch`，调用 `search` 检索当前项目已有知识
4. 对候选页面调用 `get_page`，判断是更新现有页还是新建页
5. 先写一条 `change` 页面
6. 若形成稳定事实，再分别更新 `issue / architecture / decision / practice`
7. 调用 `link_pages` 建立 `change -> long-lived page` 的显式关系
8. 必要时再次 `search` 或 `get_page`，验证新知识已经可被检索

这条 recipe 是跨 Claude Code / Cursor / Codex / Gemini CLI 的统一规则主线。
这里也需要明确：这是一条推荐 recipe，不是服务端强制约束；`put_page` 不会因为当前 git 分支不是 `main_branch` 就拒绝写入。

### 7.5 `change` 页面协议

`change` 仍是 v1 中最关键的过程型页面类型。

默认要求：

- 对一次有意义的 `bugfix / refactor / feature / rollback / recovery`，当结果已经落在项目 `main_branch` 时，Agent 应优先写一条 `change`
- `change` 是长期知识的上游证据页，但不会自动触发长期知识生成
- 是否继续补写 `issue / architecture / decision / practice`，由 Agent 在读过现有页面后决定
- 非主分支上的开发过程默认不写共享 `change`，而是在合并回主分支后再整理正式记忆

推荐实践：

- 一个稳定工作单元对应一条主要 `change`
- trivial 修改、纯格式调整、无知识价值的微小改动可以不单独写 `change`
- `change` 页中应显式记录背景、目标、实际修改、原因、影响范围、关联知识和时间线

### 7.6 `put_page` 合同

`put_page` 的正式语义是：

- 若 slug 不存在，则创建新页面
- 若 slug 已存在，则以调用方提供的完整页面内容覆盖更新

服务端职责只包括：

- 校验 `project` 与 `slug` 格式是否基本合法
- 校验 frontmatter 必填字段与枚举约束是否满足
- 将 frontmatter 中的 `project` 视为页面真相值；`put_page.project?` 只用于辅助解析和早期校验
- 若 `put_page.project?` 与 frontmatter 中的 `project` 同时存在但不一致，则返回校验错误
- 若 frontmatter 中显式出现 `slug`，校验其必须与 `put_page.slug` 一致
- 在校验失败时返回具体字段与原因，而不是静默接受不合法内容
- 将 Markdown 写入真相源
- 刷新 `pages / page_scopes / timeline_entries / pages_fts`

服务端不负责：

- 自动选择 slug
- 自动补全正文结构
- 自动合并 timeline
- 自动寻找“最相近旧页面”并替换
- 检查当前 git 分支是否等于 `main_branch`

因此，Agent 在调用 `put_page` 之前应先完成：

- `search` 当前项目知识
- `get_page` 读取可能要更新的目标页
- 自己决定这次应更新哪个 slug，还是创建新 slug

可执行的最小校验清单如下：

- 必填 frontmatter：`project`、`type`、`title`、`status`、`source_type`、`source_agent`、`created_at`、`updated_at`
- `type` 必须属于：`issue | architecture | decision | practice | change`
- `source_type` 必须属于：`manual | agent | import`
- `status` 应符合当前页面 `type` 的推荐枚举
- `change` 页面应使用 `change/<year>/<yyyy-mm-dd>-<slug>` 形式的 slug
- 长期知识页应使用 `<type>/<slug>` 形式的 slug

推荐统一错误格式如下：

```json
{
  "error": "validation_failed",
  "message": "frontmatter validation failed",
  "details": [
    {
      "field": "type",
      "message": "type 'module' is not a valid type. Expected: issue | architecture | decision | practice | change"
    }
  ]
}
```

### 7.7 非核心服务能力的处理原则

以下能力不属于当前核心服务设计：

- `record_change`
- `sync_commits`
- `scan_structure`
- 服务端自动 conflict signal
- 服务端自动 dedup / self-healing

如果后续仍需要这些能力，应按以下方式处理：

- 作为 Agent recipe
- 作为外部脚本
- 或作为 companion workflow 文档

但它们都不应成为 BrainCode v1 核心服务职责，也不应进入当前正式工具面。

---

## 八、公开接口设计

### 8.1 MCP 工具

v1 对外只暴露少量稳定工具：

| 工具名 | 作用 | 关键参数 |
|---|---|---|
| `search` | 搜索知识 | `query`, `project?`, `global?`, `types?`, `scope_refs?`, `limit?`, `context_path?` |
| `get_page` | 获取单页 | `slug`, `project?` |
| `list_pages` | 列表查询 | `project?`, `types?`, `status?`, `tags?`, `scope_refs?`, `limit?` |
| `put_page` | 创建或更新单页 | `project?`, `slug`, `content`, `context_path?` |
| `link_pages` | 建立关系 | `project`, `from_slug`, `to_slug`, `relation`, `context?` |
| `get_links` | 查询关系 | `project`, `slug`, `direction?` |
| `reindex` | 从 Markdown 重建索引 | `project?`, `full?` |∏

接口设计原则：

- 不单独暴露 `smart_search`
- 不暴露 `record_change / sync_commits / scan_structure`
- 是否使用 LLM 由服务内部和配置决定
- `put_page` 中以 frontmatter 的 `project` 为页面真相值；工具参数 `project?` 只做辅助解析和一致性校验
- 如需物理删除页面，建议只保留为 owner-only 的 CLI 管理原语，不进入默认 MCP 工具面

### 8.2 CLI 命令

CLI 与 MCP 共享同一套 operations：

```bash
braincode setup
braincode doctor
braincode config path
braincode config show
braincode config validate
braincode config edit
braincode serve
braincode serve --remote --ip 127.0.0.1 --port 7331
braincode search "electron sandbox crash" --project kilo-code
braincode get issue/electron-sandbox-crash --project kilo-code
braincode list --project kilo-code --type issue,practice
braincode put change/2026/2026-04-18-preload-bridge --project kilo-code --file ./change.md
braincode put practice/preload-bridge-rule --project kilo-code --file ./practice.md
braincode link --project kilo-code --from change/2026/2026-04-18-preload-bridge --to issue/electron-sandbox-crash --rel updates
braincode reindex --project kilo-code
braincode sync status
braincode sync pull
braincode sync push
braincode project add --name kilo-code --path ~/work/kilo-code --url github.com/your-org/kilo-code --branch main
braincode project list
braincode pj add -n kilo-code -p ~/work/kilo-code -u github.com/your-org/kilo-code -b main
braincode pj ls
braincode s "electron sandbox crash" -p kilo-code
braincode ls -p kilo-code -t issue,practice
braincode idx --all
```

等价简写为 `braincode serve -r -i 127.0.0.1 -p 7331`。

`braincode serve --remote` 在未传 `--ip/--port` 或 `-i/-p` 时使用配置中的 `server.host/server.port`，默认值为 `127.0.0.1:7331`。

### 8.3 配置向导

`braincode setup` 是推荐首次入口，负责引导本地路径、项目注册、可选 LLM、可选 embedding、远程同步和 MCP 客户端配置提示。

- `braincode init` 保持最小、脚本友好的 bootstrap，不默认进入交互
- `braincode setup --non-interactive` 用于自动化部署，缺少必要参数时必须失败并列出缺失项
- API key 和 token 不写入 config，只保存 `api_key_env`、`token_env`、`auth_token_env`
- 当启用 remote server 模式且 server token 环境变量未设置时，setup 输出一次强随机 `BRAINCODE_SERVER_TOKEN` 的 export 提示；该 token 不写入 YAML，不由 `serve` 临时生成
- `braincode doctor` 负责检查 config、路径、项目 roots、模型/远程所需环境变量
- `braincode config path/show/validate/edit` 提供固定配置维护入口
- setup 不改变 MCP thin-service 工具面

CLI 的正式职责：

- 配置与项目注册
- 脚本化写入
- 批处理与调试
- 在某些 Agent 环境下作为 MCP 的补位
- 远程模式下的手动 pull/push 同步

CLI/MCP 一致性要求：

- 默认共享的业务操作必须复用同一套 operations 和校验逻辑
- 如 `--file` 这类 CLI 便捷参数，最终都应映射到与 MCP 相同的 `content` 语义
- 默认共享的业务操作不能出现“CLI 能做但 MCP 不能做”或反之的行为分裂
- 若后续提供 `delete_page`，应默认仅作为 CLI-only 管理命令存在，不作为 Agent 的默认工作流接口

### 8.4 配置文件

最小配置示例：

```yaml
# ~/.braincode/config.yaml

brain:
  repo: ~/.braincode/brain-repo
  index_db: ~/.braincode/index.db

projects:
  - id: kilo-code
    main_branch: main
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
```

高级配置示例：

```yaml
# ~/.braincode/config.yaml

brain:
  repo: ~/.braincode/brain-repo
  index_db: ~/.braincode/index.db

projects:
  - id: kilo-code
    title: Kilo Code
    main_branch: main
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
  providers:
    zhipu:
      mode: openai-compatible
      base_url: https://open.bigmodel.cn/api/paas/v4/
      api_key_env: ZAI_API_KEY
      default_model: glm-default
      capabilities:
        chat_completions: true
        reasoning_control: true
    qwen_bailian:
      mode: openai-compatible
      base_url: https://dashscope.aliyuncs.com/compatible-mode/v1
      api_key_env: DASHSCOPE_API_KEY
      default_model: qwen-default
      capabilities:
        chat_completions: true
        reasoning_control: true
    minimax:
      mode: openai-compatible
      base_url: https://api.minimax.io/v1
      api_key_env: MINIMAX_API_KEY
      default_model: minimax-default
      capabilities:
        chat_completions: true
        reasoning_control: true
    deepseek:
      mode: openai-compatible
      base_url: https://api.deepseek.com
      api_key_env: DEEPSEEK_API_KEY
      default_model: deepseek-default
      capabilities:
        chat_completions: true
        reasoning_control: true
    kimi:
      mode: openai-compatible
      base_url: https://api.moonshot.cn/v1
      api_key_env: MOONSHOT_API_KEY
      default_model: kimi-default
      capabilities:
        chat_completions: true
        reasoning_control: true
  routing:
    search: deepseek
  request:
    extra_body: {}
  timeout_ms: 8000
  retries: 2

mcp:
  name: braincode
  version: 0.1.0

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

配置原则：

- 必须支持 **provider preset**
- 必须支持 **全局模型**
- 可以按能力覆盖 `search`
- 必须允许声明 capability flags，例如 `chat_completions`、`reasoning_control`

### 8.5 远程部署与同步

远程模式用于单用户多设备共享记忆：

- `braincode serve --remote` 启动单一 HTTP 服务，同时提供 `/mcp` 和 `/sync/*`
- 远程服务器上的 brain repo 是唯一真相源
- 本地副本是只读缓存，但允许通过显式 `sync push` 把本地修改覆盖推送到远程
- 项目身份由 `id/main_branch/git_remotes` 表达；远程端不依赖本地绝对路径，远程 project 可以是 `roots: []`
- `GET /sync/manifest` 的 `projects[]` 返回 `id/title/main_branch/git_remotes`
- `sync push` 在上传页面前先调用 `PUT /sync/project` 同步项目元数据；远程收到未知 project 时创建 project，`roots` 固定为空
- 如果远程发现相同 normalized Git remote 已属于另一个 project，则返回 409，避免同仓库不同名称导致重复记忆
- `sync pull` 依据 manifest 的 `content_hash` 只下载变化页面，并可按 `prune_on_pull` 删除远程已不存在的本地页面
- `sync push` 上传本地 hash 与远程不同的页面；同 slug 冲突时以本地内容覆盖远程，不做自动 merge
- `/mcp` 与 `/sync/*` 共用 Bearer token 鉴权；token 只从环境变量读取
- 应用层不加密 Markdown/SQLite，传输加密依赖 HTTPS/TLS 或等价安全通道
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
2. 默认 recipe 建议只把项目 `main_branch` 上的事实写入共享脑库；非主分支开发时默认只搜索和读页
3. 在主分支完成有意义的 bugfix/refactor/feature/recovery 后，显式执行 `brain_sync_task`
4. `brain_sync_task` 的默认顺序是：`确认分支 -> search -> get_page -> put change -> put long-lived page -> link_pages`
5. 调用时优先传稳定 `project`；`context_path` 只是本机路径辅助
6. 若要更新现有页面，先 `get_page` 再覆盖写入，不依赖服务端自动 merge

### 9.2 Claude Code

首选 MCP 配置：

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

`CLAUDE.md` 中建议加入：

```markdown
## BrainCode

- 在非 trivial 修改前先搜索当前项目知识
- 默认只在当前分支等于项目 `main_branch` 时执行 `brain_sync_task`
- `brain_sync_task`：先写 `change`，再按需更新长期知识页，并建立显式 links
- 调用工具时优先传当前项目或仓库路径
```

### 9.3 Cursor

首选 MCP 配置，配合规则文件：

```json
{
  "braincode": {
    "command": "braincode",
    "args": ["serve"]
  }
}
```

`.cursor/rules/braincode.mdc` 中建议加入同样的触发规则。

### 9.4 Codex

正式口径是 **MCP 优先，CLI 补位**：

- 若当前 Codex 环境支持 MCP，则与 Claude Code、Cursor 共用同一服务
- 若当前环境以 CLI 为主，则通过 `braincode` 命令访问相同 operations

也就是说，Codex 不再被定义为“CLI-only”的特例，而是：

- **首选 MCP**
- **当前环境不便时允许 CLI 补位**

### 9.5 Gemini CLI

v1 对 Gemini CLI 的正式支持等级是 **实验性 CLI 支持**。

正式口径是 **CLI 优先**：

- 默认通过 `braincode` CLI 访问相同 operations
- 若后续运行环境支持 MCP 或等价工具桥接，可复用同一 `braincode serve`

也就是说，Gemini CLI 在 v1 中的支持目标是：

- **先保证 CLI 路径稳定可用**
- **不排斥后续复用 MCP 接入**

v1 的可实施接入模板至少应覆盖：

```bash
braincode search "query" --context "$(pwd)"
braincode get practice/preload-bridge-rule --project kilo-code
braincode put change/2026/2026-04-18-preload-bridge --context "$(pwd)" --file ./change.md
braincode link --project kilo-code --from change/2026/2026-04-18-preload-bridge --to practice/preload-bridge-rule --rel implements
```

验收口径：

- v1 不要求 Gemini CLI 与 Claude Code 拥有完全相同的 MCP 集成体验
- v1 要求 Gemini CLI 至少能稳定走 CLI 路径完成“搜索 -> 读页 -> 写 change -> 建 link”闭环

---

## 十、测试与验收

### 10.1 核心测试场景

1. **项目自动识别与主分支解析**
   在不同 cwd、不同 git remote、显式覆盖参数下都能命中正确项目，并解析出配置中的 `main_branch`
2. **write-through 同步**
   Markdown 写入后，SQLite 立刻可搜索；手工改 Markdown 后 `reindex` 结果一致
3. **薄写入边界**
   `put_page` 只写调用方提供的页面内容，不自动派生新页面、不自动补 link、不自动改长期知识，也不把当前 git 分支作为隐藏拒绝条件
4. **混合语言搜索**
   中文问题 + 英文模块名 + 报错原文能命中正确结果
5. **跨项目边界**
   默认只搜当前项目；全局搜索可召回其他项目并带项目标识
6. **LLM 降级**
   LLM 不可用、超时或网络异常时，`search` 仍可用
7. **显式 link 图**
   `change` 与长期知识页建立 link 后，搜索结果能正确附带相关上下文
8. **四类 Agent 集成**
   Claude Code、Cursor、Codex、Gemini CLI 都能完成“先搜 -> 读页 -> 写 change -> 补长期知识 -> 建 link”的闭环

### 10.2 推荐测试分层

- **单元测试**
  - slug/path 规则
  - project resolution
  - `main_branch` 配置解析
  - markdown parser 与 `## Timeline` 分段
  - frontmatter 校验与错误返回
  - page round-trip
  - link storage
- **集成测试**
  - write-through
  - reindex
  - search fallback
  - `put_page + link_pages + get_links`
- **端到端测试**
  - Agent A 写入 -> Agent B 搜索到
  - `change` 页写入 -> 长期知识页写入 -> 建 link -> 搜索结果更新

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

- 建立可运行的本地单进程 `braincode serve`
- 打通配置加载、项目注册和 SQLite 初始化

交付物：

- 服务入口
- 配置系统
- 项目注册表（含 `main_branch`）
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

#### Phase 4：薄写入接口与 Agent 工作流

目标：

- 建立薄写入接口与 Agent 记忆整理协议

交付物：

- `put_page`
- `link_pages / get_links`
- 完整页面写入协议
- `brain_sync_task` 规则模板
- 独立的 `brain_sync_task` companion 文档（如 `docs/BRAIN_SYNC_RECIPE.md`）

完成判据：

- Agent 能稳定写入 `change`
- Agent 能通过同一套接口补写长期知识页并建立 links

#### Phase 5：Agent 集成与测试

目标：

- 把四类 Agent 的接入、规则模板和回归验证补齐

交付物：

- Claude Code / Cursor / Codex / Gemini CLI 集成模板
- 单元、集成、端到端测试
- 错误处理与降级策略验证

完成判据：

- 四类 Agent 都能完成“先搜 -> 读页 -> 写 change -> 补长期知识 -> 建 link”的闭环
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
| 多 Agent 写作风格漂移 | 页面质量和结构不一致 | 用统一 `brain_sync_task` 和页面模板约束写法 |
| 项目识别错误 | 搜错项目、写错项目 | 显式 `project` 覆盖优先，配置注册表必须可审查 |
| Markdown 与索引漂移 | 搜索结果不可信 | `write-through` + `reindex` 兜底 |
| 长期知识页重复增长 | 知识碎片化 | Agent 在写入前必须先 `search/get_page`，并遵守统一 slug 与更新规则 |

### 12.2 产品假设

以下假设已在本设计中锁定：

- v1 仍是单用户产品，不做权限、多用户协作、Web UI、云端托管
- v1 只正式适配 Claude Code / Cursor / Codex / Gemini CLI
- v1 不以 embedding 为依赖，embedding 仅作为未来可选优化位
- 默认采用集中脑库仓库 + 单全局 SQLite 索引库
- 默认搜索体验以质量优先为准，接受 LLM 查询改写与重排作为主链路
- 默认记忆整理是 Agent 的显式 recipe，不是服务端后台自动提炼

### 12.3 结论

BrainCode 的 v1 不是“再做一个记笔记工具”，而是把以下三件事做成一个稳定系统：

1. **把代码知识写成可长期维护的 Markdown**
2. **把多项目知识用 SQLite 高质量检索起来**
3. **给多个 Agent 一套共享的显式记忆整理协议，让它们把过程知识整理成可追溯页面与 links**

这也是它区别于规则文件、传统 wiki 和通用记忆层的核心价值：保留 gbrain 式薄服务边界，但把对象和协议收敛到代码知识场景。
