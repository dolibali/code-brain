# BrainCode DESIGN.md 架构评审报告

> **评审版本：** DESIGN.md v0.2-spec (2026-04-18)
> **评审人角色：** 技术架构师 + 方案评审专家
> **参考对比：** GBrain v0 设计文档
> **评审日期：** 2026-04-18

---

## 一、总体判断

1. **这份文档处于"方向性设计稿"和"可实施设计稿"之间**，自标为"可实施设计稿"偏乐观。产品定义、数据模型和架构分层的表述质量不错，但多个关键链路缺乏足够的实现规格，无法直接交给工程师（或 AI）开箱执行。

2. **产品定位是清晰的**，与 GBrain 的差异化也做得比较到位——明确不做通用个人知识库、不依赖 embedding、不依赖 Postgres。这是正确的。

3. **`change → long-lived knowledge` 是整个方案的核心价值叙事，但同时也是实现风险最高的区域。** 文档对这条链路的规则描述停留在"推荐判断"层面，离真正可实现的 policy/heuristic 还差至少一层规格。

4. **搜索设计合理但对 LLM 依赖权重偏高。** 默认搜索体验目标 3-8 秒在代码场景下太慢，会严重影响 Agent 工作流的流畅度。

5. **LLM 供应商兼容策略的意图正确，但描述粒度不足以防止实现时踩坑。** 特别是 tool calling 协议差异和流式响应差异被低估了。

6. **多 Agent 集成描述是四者最弱的部分。** Claude Code 和 Cursor 的规格尚可操作，但 Codex 和 Gemini CLI 的接入方式仍是意向性描述，不是可实施规格。

7. **测试与验收标准有框架，但过于依赖人工判断，缺乏自动化验收的 fixture 和 golden test 设计。**

8. **与 GBrain 对比，BrainCode 做了正确的减法（去掉 Postgres/embedding/enrichment），但在某些地方减过头了**——特别是页面版本控制、stale 检测和 link graph 遍历，这些在代码知识场景下同样有价值。

---

## 二、主要问题（按严重程度排序）

### P0-1：`change → long-lived knowledge` 的自动提取规则无法实现

**问题所在：** [§7.5 自动 upsert 长期知识的规则](file:///Users/zhangrich/work/braincode/docs/DESIGN.md#L876-L892)

文档这样写：

> - **生成 `issue`**：当变更明确对应某个问题、根因和修复事实
> - **更新 `architecture`**：当变更改变模块边界、关键结构、依赖关系或主流程
> - **更新 `decision`**：当变更体现出正式技术选型、取舍或重大的方向性判断
> - **更新 `practice`**：当变更形成可复用的规则、反模式或编码约束

**为什么是问题：**

这些"推荐判断"无法被程序化执行。它们要求系统理解 diff 的语义含义——这在没有 LLM 的情况下不可能做到，而文档同时声明 LLM 是"可选"的（§2.2 原则 1）。

这意味着：
- **若 LLM 不可用**：`record_change` 只能生成 `change` 页面，整个 `change → long-lived knowledge` 链路断裂，系统退化成一个 change log 记录器
- **若 LLM 可用**：需要极其复杂的 prompt engineering 来判断"这个 diff 是不是在改模块边界"，错误率不可控

**影响范围：** 这是产品核心价值主张的实现基础。如果这条链路不稳定，1.4 成功标准中的第 2、3 条（自动沉淀 change + 自动更新长期知识）无法达成。

**建议修正方向：**

1. 明确区分两种模式：
   - **LLM 模式**：可以做语义判断，自动 upsert 长期知识
   - **规则模式**：只基于结构化元数据（scope_refs 变化、文件路径 pattern、commit message convention）做简单关联
2. 为每种 upsert 判断提供具体的 heuristic 规格，例如：
   - "若 diff 涉及的文件路径与已有 `architecture` 页面的 `scope_refs` 有 ≥2 个交集 → 生成关联 link"
   - "若 commit message 包含 `fix:` `bug:` `hotfix:` → 候选关联到 `issue`"
3. 考虑引入 `Agent 显式标注` 作为最可靠的触发方式——即让 Agent 在调用 `record_change` 时声明意图（例如 `related_types: [issue, architecture]`），而非完全靠系统自动推断

---

### P0-2：搜索性能目标 3-8 秒对 Agent 工作流不现实

**问题所在：** [§6.6 性能目标](file:///Users/zhangrich/work/braincode/docs/DESIGN.md#L802-L811)

> 智能搜索：常态 3-8 秒

**为什么是问题：**

Agent 在编码过程中调用 `search` 是一个高频、同步阻塞的操作。3-8 秒意味着：

- Claude Code 每次"先搜再改"会卡住 3-8 秒
- 如果一个任务需要搜 2-3 次，光搜索就要 10-24 秒
- 用户体感是"这个 Agent 比不接 BrainCode 时慢了很多"

对比：GBrain 的搜索目标虽然没有明确写延迟，但其 FTS5 + pgvector hybrid search 设计的本地路径通常在亚秒级。

**影响范围：** 直接影响产品可用性和用户留存。如果 Agent 因为等搜索而显著变慢，用户会关掉 BrainCode。

**建议修正方向：**

1. **反转默认策略**：默认用本地 FTS5 快速搜索（< 500ms），LLM 增强作为异步二次优化或仅在用户显式触发时启用
2. 明确区分两个性能档位：
   - `fast_search`（本地 FTS5）：< 500ms，Agent 默认使用
   - `deep_search`（LLM 增强）：3-8 秒，仅在快速搜索无结果或用户显式请求时触发
3. 在 MCP 工具参数中增加 `mode: fast | deep` 控制

---

### P0-3：FTS5 的中文搜索能力被隐含假设了

**问题所在：** [§6.1 目标](file:///Users/zhangrich/work/braincode/docs/DESIGN.md#L730-L740) + [§5.2 pages_fts](file:///Users/zhangrich/work/braincode/docs/DESIGN.md#L676-L687)

> 搜索必须同时满足：支持中英混合查询

但 SQLite FTS5 的默认 tokenizer 对中文的支持极差——它使用 unicode61 tokenizer，会把中文文本按 unicode 分割但不做分词，基本无法做中文全文检索。

**为什么是问题：**

- 中文查询"electron 沙箱崩溃"中的"沙箱崩溃"在默认 FTS5 下大概率无法命中
- 这是产品成功标准第 4 条的硬依赖
- 文档完全没有提到 FTS5 中文分词方案

**影响范围：** 中文搜索能力是核心 scope。如果降级搜索路径都不支持中文，"LLM 不可用时保持基础可用"的承诺就只对英文成立。

**建议修正方向：**

1. 明确 FTS5 tokenizer 选型：
   - 若用 TypeScript：考虑在索引时预处理中文分词（结巴分词 JS 版、nodejieba），然后存入 FTS5
   - 若用 Python：同理，使用 jieba 等分词后再索引
   - 或使用 ICU tokenizer（FTS5 支持，但需要编译 SQLite 时启用 ICU 扩展）
2. 在 `pages_fts` 的设计中明确分词策略
3. 添加中文搜索的专项测试场景

---

### P0-4：Markdown → SQLite 同步的原子性缺乏实现规格

**问题所在：** [§5.3 Write-through 同步](file:///Users/zhangrich/work/braincode/docs/DESIGN.md#L697-L713)

文档描述的同步流程是：
> 1. 解析目标 → 2. 生成/更新 Markdown → 3. 原子写入文件 → 4. 重新解析 → 5. 更新 SQLite → 6. 返回结果

**为什么是问题：**

- 步骤 3 和步骤 5 之间存在不一致窗口。如果进程在步骤 3 之后、步骤 5 之前崩溃，Markdown 已更新但 SQLite 未更新
- "原子写入文件"的实现方式未定义（write-to-temp + rename？直接 overwrite？）
- 并发情况未考虑：如果两个 Agent（Claude Code 和 Cursor）同时调用 `record_change` 写同一项目，如何处理
- SQLite 在多进程并发写入时有 locked database 问题（WAL 模式下有所缓解，但文档没提到）

**影响范围：** Markdown-SQLite 一致性是整个系统的信任基础。

**建议修正方向：**

1. 明确 SQLite 使用 WAL 模式
2. 明确 write-through 的事务边界：在 SQLite 事务内做 `file write + index update`，失败时回滚文件（或反之）
3. 增加 `consistency_check` 工具或参数，用于检测 Markdown 与 SQLite 的差异
4. 明确并发策略：v1 是否通过单进程排队回避并发？如果是，需要明确声明"同一时刻只有一个写入操作在执行"

---

### P1-1：`fingerprint` 的去重方案缺乏具体算法

**问题所在：** [§7.6 去重与更新策略](file:///Users/zhangrich/work/braincode/docs/DESIGN.md#L894-L907)

> `change` 去重优先依据 `fingerprint`，由 `project + source_ref + change_kind + primary scope_refs` 组成

**为什么是问题：**

- `source_ref` 没有定义是什么——是 commit hash？diff 的内容 hash？Agent session ID？
- "primary scope_refs" 是指 scope_refs 中的第一个？还是某种规范化后的值？
- 如果同一个文件的两次不同 bugfix 具有相同的 `project + change_kind + primary scope_refs`，它们如何区分？
- 这个 fingerprint 策略对于"Agent 反复重试提交同一个变更"和"一天内同一模块多次 bugfix"两种场景是否都能正确工作？

**影响范围：** 去重错误会造成要么知识丢失（误判为重复），要么知识膨胀（无限重复创建）。

**建议修正方向：**

1. 精确定义 `source_ref` 的语义和来源
2. 给出 fingerprint 的具体计算方式（hash 函数、字段拼接规则）
3. 增加 fingerprint 碰撞的处理策略
4. 增加"近似去重"的阈值规则（不只是精确匹配）

---

### P1-2：Gemini CLI 的接入定义不足以指导实现

**问题所在：** [§9.5 Gemini CLI](file:///Users/zhangrich/work/braincode/docs/DESIGN.md#L1144-L1155)

> - 默认通过 `braincode` CLI 访问相同 operations
> - 若后续运行环境支持 MCP 或等价工具桥接，可复用同一 `braincode serve`

**为什么是问题：**

Gemini CLI 的接入方式完全是意向性的。实际问题包括：

1. **Gemini CLI 如何知道要调用 braincode？** Claude Code 有 `CLAUDE.md`，Cursor 有 `.cursor/rules/`，但 Gemini CLI 的工具注册和规则注入方式是什么？文档没有给出可操作的配置示例
2. **CLI 调用时的上下文传递**：Gemini CLI 运行时，`context_path` 如何自动传入？是需要 Gemini CLI 的 prompt 里明确编排 `braincode search --context-path $(pwd)` 吗？
3. **Gemini CLI 是否支持 MCP？** 截至 2026 年 4 月，Gemini CLI 的 MCP 支持程度是什么？文档没有做事实确认

**影响范围：** 四类 Agent 集成是产品核心卖点。如果其中一个没有可操作的接入方案，成功标准中的"四类 Agent 闭环"无法验收。

**建议修正方向：**

1. 提供 Gemini CLI 的具体接入模板（类似 Claude Code 的 `CLAUDE.md` + MCP config）
2. 如果 Gemini CLI 暂不支持 MCP，明确 CLI 调用方式的完整 shell 命令模板
3. 明确声明 Gemini CLI 在 v1 中的支持等级（完全支持 vs 实验性支持 vs 降级支持）

---

### P1-3：`scope_refs` 的维护成本和可靠性未评估

**问题所在：** [§4.3 scope_refs 结构](file:///Users/zhangrich/work/braincode/docs/DESIGN.md#L368-L392)

```yaml
scope_refs:
  - kind: file
    value: src/main/preload.ts
  - kind: symbol
    value: BootstrapExtensionHost
```

**为什么是问题：**

1. **文件路径会随重构而改变**：`src/main/preload.ts` 如果被 rename，所有引用它的知识页的 `scope_refs` 都会过时。文档没有任何 stale reference 的检测或更新机制
2. **symbol 名会随重构而改变**：`BootstrapExtensionHost` 如果被重命名，同上
3. **自动提取 scope_refs 的准确性**：从 diff 中自动提取 `kind: module / value: src/extension-host` 需要理解项目的模块结构定义，这不是从 diff 能直接推断的
4. **symbol 级别的 scope_ref 几乎不可能自动维护**：代码符号的变化频率远高于架构变化频率

**影响范围：** scope_refs 是搜索质量的核心信号之一（§6.4 排序规则第 3 条）。如果 scope_refs 大面积过时，基于它的精确匹配加权就会成为噪音。

**建议修正方向：**

1. v1 是否应该只保留 `repo` 和 `module` 级别的 scope_ref，而不是一开始就推到 `file` 和 `symbol`？
2. 增加 scope_ref stale 检测机制（定期扫描项目文件系统，标记不存在的 file/symbol ref）
3. 在 `reindex` 或独立 `audit` 命令中增加 scope_ref 有效性验证

---

### P1-4：配置复杂度过高，与"适合 AI 快速迭代"矛盾

**问题所在：** [§8.3 配置文件](file:///Users/zhangrich/work/braincode/docs/DESIGN.md#L974-L1077)

配置示例有 90+ 行 YAML，包含多个 provider preset，每个有独立的 base_url、api_key_env、capabilities、routing 配置。

**为什么是问题：**

1. 新用户首次配置的门槛极高——需要理解 provider preset、capability flags、routing、extra_body 等概念
2. 文档声明产品"适合 AI 快速迭代"（§3.6），但这个配置模型对 AI Agent 来说也不容易自动生成正确配置
3. 大部分用户在 v1 可能只用一个 LLM provider，但配置模板暗示需要配多个

**建议修正方向：**

1. 提供一个 **最小配置** 示例（≤ 15 行），只有 `brain.repo`、`projects`、`llm.api`
2. 把多 provider routing 标记为"高级配置"
3. 增加 `braincode init` 交互式配置向导，类似 GBrain 的 init wizard
4. 提供 `braincode config validate` 命令

---

## 三、次要问题与可优化点

### S1：没有页面版本控制

GBrain 有 `page_versions` 表和 `gbrain history/diff/revert` 命令。BrainCode 的 Markdown-as-truth 虽然可以依赖 git 版本控制，但文档没有显式说明这一点。如果 brain repo 不在 git 管理下（虽然不推荐），页面修改就不可回溯。

**建议：** 显式声明 brain repo 必须是 git 仓库，或在 SQLite 增加简单的 snapshot 机制。

---

### S2：`see_also` vs `page_links` 的关系模糊

§4.4 说：
> `see_also` 是显式链接提示，真正的关系以索引层 link 表为准

但 §4.7 的关系类型（`relates_to / updates / implements / evidences / supersedes`）存储在 `page_links` 表，而 `see_also` 在 frontmatter 中。

**问题：** 哪些关系走 frontmatter `see_also`，哪些走 `page_links` 表？它们会不会不一致？`see_also` 被修改时 `page_links` 是否要同步？

**建议：** 明确 `see_also` 仅为人类便利字段，系统行为以 `page_links` 为准；或将 `see_also` 彻底移入 `page_links` 避免双源。

---

### S3：`status` 字段的枚举值定义不完整

§4.2 提到：
> `status`: 页面状态，示例 `fixed`, `active`, `accepted`

但没有给出完整的 status 枚举，也没有按页面类型区分。例如：
- `issue` 的 status 应该是 `open / investigating / fixed / wont_fix`？
- `architecture` 的 status 应该是 `current / deprecated / proposed`？
- `change` 的 status 应该是 `recorded / validated / reverted`？

没有枚举定义会导致实现者各自发明状态值，后续搜索过滤不一致。

**建议：** 为每种 type 定义推荐 status 枚举。

---

### S4：缺乏 stale 知识检测

BrainCode 记录了 `created_at` 和 `updated_at`，但没有主动检测过时知识的机制。一条 6 个月前的 `architecture` 页面可能已经严重不符合当前代码实际结构。

GBrain 有 stale alert 机制：当 compiled_truth 比最新 timeline entry 更旧时标记为 stale。

**建议：** v1 至少增加一个 `stale_pages` 查询或 `list_pages --stale` 过滤，基于 `updated_at` 与当前时间的差异。

---

### S5：`ingest_events.fingerprint` 的唯一性约束缺失

§5.2 中 `ingest_events` 表定义里，`fingerprint` 是 `TEXT NOT NULL`，但没有 UNIQUE 约束。如果 fingerprint 是去重依据（§7.6），应该加唯一约束。

---

### S6：`record_change` 在无 diff / 无 commit / 无 summary 时的行为未定义

§7.4 的流程假设输入中至少有一项（diff / commit message / agent summary），但调用方完全可能三项都不传或都为空。这个边界行为需要明确：是报错、是拒绝、还是创建一个空壳 change？

---

### S7：CLI 参数设计与 MCP 参数存在语义缝合

对比 §8.1 MCP 工具表和 §8.2 CLI 命令，CLI 的 `record_change` 用了 `--summary-file ./summary.md` 而 MCP 的参数是 `agent_summary`（inline text）。这种输入格式差异需要在 operations 层统一处理，否则 CLI 和 MCP 的行为可能分裂。

---

## 四、缺失的规格

| 缺失项 | 为什么关键 | 建议如何补 |
|---|---|---|
| **FTS5 tokenizer 方案** | 中文搜索不可用 | 在§5.2 增加 tokenizer 选型和中文分词策略 |
| **`record_change` 的 LLM prompt 模板** | 自动提取的核心实现依赖 | 提供至少一个完整的 prompt 示例，展示从 diff 提取 change_kind/scope_refs/title 的 prompt 结构 |
| **长期知识 upsert 判断的具体 heuristic** | P0-1 中已详细说明 | 为每种 type 提供规则式条件 + LLM 增强条件 |
| **错误处理与重试策略** | LLM 调用失败、SQLite 锁、文件系统错误等场景的处理方式 | 增加统一的 error model 章节 |
| **slug 生成规则** | slug 是页面唯一标识，但生成规则未完整定义（是 title 的 slug 化？是否允许中文？冲突如何处理？） | 增加 slug 规范章节 |
| **Markdown 正文如何从 compiled_truth 和 timeline 中分割解析** | 这是 Markdown → SQLite 索引的核心技术细节 | 明确分割标记（例如 `## Timeline` 标题作为分界线？还是用 `---` 分隔符？） |
| **MCP transport 方式** | 是 stdio 还是 SSE？还是 HTTP？ | 明确声明（从 Claude Code 的配置模板推断是 stdio，但应显式声明） |
| **数据迁移策略** | 如果用户已有 Markdown 知识文件但没有 BrainCode 的 frontmatter 格式 | 增加 `import` / `migrate` 工具或说明 |
| **并发控制策略** | 多 Agent 同时写入同一项目时的行为 | 声明 v1 是否通过单进程 + 请求排队回避 |
| **日志与可观测性** | 调试和问题排查的基础 | 增加日志级别、结构化日志输出的要求 |

---

## 五、建议保留的设计

### ✅ Markdown 为真相源 + SQLite 为索引层

这个决策是正确的。与 GBrain 的 Postgres-first 相比，BrainCode 的受众是本地开发者，`git + Markdown + SQLite` 三件套完全契合目标用户画像——无需额外数据库服务，知识文件可读可改可审计，索引层出问题可以从 Markdown 全量重建。

这也是 BrainCode 与其他"记忆 MCP"产品的核心差异化所在。

### ✅ 5 个顶层类型的收敛

`issue / architecture / decision / practice / change` 的五元分类是足够的。把 `module` 收入 `architecture`、`pitfall` 收入 `practice`、取消 `pattern` 独立类型，这些都是正确的简化。

与 GBrain 的 `people / companies / deals / meetings / projects / ideas / concepts / writing / programs / ...` 16+ 类型相比，BrainCode 做了正确的领域聚焦。

### ✅ Compiled Truth + Timeline 协议

从 GBrain 继承的双层结构在代码知识场景下同样适用。"上层是当前最佳理解，下层是时间线证据"的模型可以很好地处理"一个 bug 修了三次"或"一个架构经历了两次重构"的场景。

### ✅ 单一搜索入口 + 内部自动降级

不暴露 `search` / `smart_search` 两套 API 是正确的。Agent 不应该需要理解搜索引擎的内部实现来选择 API。

### ✅ `change` 作为一等页面类型

这是 BrainCode 相对于静态知识库的核心增量点。GBrain 有 `timeline_entries`，但 BrainCode 把开发过程提升为独立页面类型，使得"发生了什么变更"和"现在的结论是什么"形成对等的两层知识，这是适合代码场景的设计。

### ✅ 中央脑库 + 项目隔离

一个 brain repo 管多个项目、搜索按当前项目优先的策略是合理的。对比"每个项目一个 brain"的方案，集中管理更利于跨项目知识复用和统一搜索。

### ✅ 不依赖 embedding 作为核心前提

v1 不把 embedding 作为必须依赖是务实的。Embedding 增加了部署复杂度和成本，对于代码知识场景（大量精确术语和路径），FTS5 + 结构化维度过滤已经能覆盖大部分需求。

---

## 六、最终结论

### 这个方案是否已经可以进入实现阶段？

**不能直接进入全面实现。** 但已经可以进入 **Phase 1（基础骨架）和 Phase 2（知识模型与同步）** 的实现，因为这两个阶段的规格是够的。

Phase 3（搜索）和 Phase 4（自动提取）需要先补齐以下规格才能开始：

### 最少还要补齐的内容

1. **FTS5 中文分词方案**（否则搜索链路在中文场景下不可用）
2. **`change → long-lived knowledge` 的具体判断规则**（至少规则模式的 heuristic 必须定义清楚）
3. **搜索性能策略的重新定义**（3-8 秒作为默认不可接受，需要 fast/deep 两档）
4. **write-through 同步的并发与原子性方案**
5. **slug 生成规则和 Markdown 正文分区解析规格**

以上 5 项补齐后，方案可以支撑到 Phase 4 实现结束。Phase 5（Agent 集成）的 Gemini CLI 部分仍需要技术调研来确认可行方案。

> [!IMPORTANT]
> 总结一句话：**产品定义清晰、架构分层合理、关键差异化正确，但核心链路（自动提取 + 搜索）的实现规格还差一层。把它从"方向性设计稿"推到"可实施设计稿"大约还需要补 2-3 天的规格填充。**
