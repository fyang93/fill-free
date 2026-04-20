# OpenCode → pi-mono SDK 迁移计划

依据 `docs/principles.md`，这次调整按“更干净的新真相优先、不要为旧结构保留 shim、保持 CLI + skills 主执行面、让 runtime 保持薄”来执行。

## 迁移目标

把当前 bot 的 AI 执行层从 **OpenCode server + `@opencode-ai/sdk`** 完整迁移到 **pi-mono / `@mariozechner/pi-coding-agent` SDK**，并把仓库里的实现、配置、脚本、文档、测试一起切到新的单一事实来源。

迁移完成后应满足：

- 运行时不再依赖本地 OpenCode server
- 代码中不再依赖 `@opencode-ai/sdk` / `opencode-ai`
- `src/bot/ai/**` 通过 pi SDK 直接创建和管理 agent session
- 短期对话上下文继续按 scope 保持会话，但由 pi SDK 的 session 承担
- 仓库技能仍以 `.agents/skills/**` 为主，符合 CLI + skills 原则
- 模型发现、提示执行、工具执行、取消、中止、会话重建都走 pi SDK
- README / 配置示例 / justfile / live test 说明全部改到新现实
- 测试与类型检查在新实现上通过

## 现状审计

当前仓库里和 OpenCode 强耦合的点主要有：

1. **依赖与脚本**
   - `package.json` 依赖 `@opencode-ai/sdk`、`opencode-ai`
   - `just serve` 会先启动 `opencode serve --port 4096`

2. **配置面**
   - `AppConfig` 含 `opencode.baseUrl`
   - `config.toml.example`、README、测试 fixture 都要求 `[opencode].base_url`

3. **AI 网关实现**
   - `src/bot/ai/gateway.ts` 全部基于 OpenCode HTTP client
   - readiness、session create/abort、prompt、model list、execution parts 恢复都绑定 OpenCode payload 结构

4. **文案与测试**
   - README / README.zh-CN / live tests / startup warning 都直接写 OpenCode server

## 设计决策

### 1. 新的执行骨架

保持现有 `AiService` 对 bot runtime 的接口基本稳定，但把内部实现替换为 pi SDK：

- 用 `createAgentSession()` 创建 role-specific session
- 用 `DefaultResourceLoader` 发现本仓库 `.agents/skills/**`
- 用内存 session 管理 scoped conversation session
- 用 SDK 事件流捕获：
  - assistant 文本
  - tool execution 完成事件
  - 中止 / 失败

### 2. 资源与配置边界

遵循“更干净的新设计优先”，**删除** OpenCode 配置段，不保留兼容字段。

新的默认策略：

- 不再需要 `[opencode]`
- pi 的 project `cwd` 使用 `config.paths.repoRoot`
- pi 的 `agentDir` 使用仓库本地目录（例如 `<repo>/.pi-agent`），避免把全局 prompt / skill / append-system 污染到本项目运行时
- 认证默认依赖 pi SDK 自身的环境变量 / auth file 解析能力，不在 bot 侧重复实现一层凭证管理
- `/model` 的候选列表允许按产品需求补充动态拉取逻辑，但凭证解析仍尽量复用 pi 原生能力

### 3. 系统提示与技能发现

- assistant / writer / maintainer 的角色提示仍由本仓库代码生成
- 通过 `DefaultResourceLoader.systemPromptOverride` 注入仓库自定义 system prompt
- 通过 `appendSystemPromptOverride: () => []` 去掉外部追加 prompt，确保本仓库提示边界清晰
- skills 继续主要来自仓库 `.agents/skills/**`

### 4. 会话模型

- `user:<id>` / `chat:<id>` scope 的短期会话继续保留
- 每个 scope 维护一个 pi `AgentSession`
- `/new` 语义保持：丢弃旧 session，创建新 session
- 中断使用 pi session 的 `abort()`
- 停机时 `dispose()` 本地 session

### 5. 模型发现与选择

- `/model` 菜单继续保留
- `state.model` 继续保存 `provider/model` 字符串
- OpenAI provider 的模型列表直接从 OpenAI API 拉取
- OpenRouter 只展示免费模型：`pricing == 0` 且模型名以 `:free` 结尾，并显式补上 `openrouter/free`
- 不再做“不可用模型自动 fallback 到默认模型”的旧语义；已选模型不可用时直接报错/要求重新选择

### 6. 附件处理

- 继续坚持“text-first + saved file paths”原则
- 对图片类 `AiAttachment`，尽量映射到 pi `images` 输入
- 非图片附件仍主要通过保存后的仓库路径交给模型使用 repo tools 读取

## 实施阶段

### 阶段 A：文档与依赖切换

- 新增本迁移计划文档
- 替换依赖：移除 OpenCode，加入 pi SDK
- 更新脚本与启动说明，不再启动 OpenCode server

### 阶段 B：配置面重塑

- 从 `AppConfig`、`config.ts`、`config_runtime.ts` 删除 `opencode`
- 更新所有测试 fixture 与配置示例

### 阶段 C：AI 网关重写

- 重写 `src/bot/ai/gateway.ts`
- 引入 pi SDK session、resource loader、model registry、settings manager
- 复刻现有 `AiService` 对外行为：
  - `ensureReady`
  - `newSession`
  - `abortCurrentSession`
  - `listModels`
  - writer / maintainer / assistant 三类 prompt 路径
  - completed actions 收集

### 阶段 D：文档与术语清理

- README / README.zh-CN / architecture 文档切换到 pi SDK 现实
- live test 注释、启动提示、日志文案全部去 OpenCode

### 阶段 E：验证与收尾

- 跑类型检查
- 跑自动化测试
- 搜索残留 `opencode` / `OpenCode`
- 若仍有残留，仅允许出现在迁移说明或历史上下文文档中；运行路径、配置、说明不得残留

## 验收标准

迁移完成必须满足：

1. `rg -n "@opencode-ai/sdk|opencode-ai|\[opencode\]|OpenCode server|opencode serve" .` 不再命中运行时与说明路径
2. `npm run check` 通过
3. `npm test` 通过
4. `src/bot/ai/gateway.ts` 已完全改为 pi SDK 实现
5. README 与 config example 已不再要求 OpenCode server

## 风险点

### 风险 1：pi SDK 事件结构与当前测试 stub 不同
处理：把 `AiService` 的对外接口保持稳定，只重写内部采集逻辑，并同步更新单测 stub 方式。

### 风险 2：全局 pi 配置污染项目行为
处理：使用 repo-local `agentDir`，并覆盖 append system prompt，确保项目级 system prompt 与 skills 边界清楚。

### 风险 3：模型可用性依赖本机凭证
处理：`ensureReady()` 改为检查 pi registry 中是否存在可用模型，并在 live docs 里明确需要先配置 pi 凭证。

## 执行顺序

按上面阶段顺序执行；不做 OpenCode / pi 双栈兼容，不保留旧字段或临时桥接层。迁移完成后，以 pi SDK 版本为新的唯一真实实现。