# The Defect Bot

[English README](README.md)

The Defect Bot 是一个本地优先的个人记忆仓库，带有由 OpenCode 驱动的 Telegram bot 入口。它不完美，但免费。

## 怎么使用

一般情况下，你不需要手动编辑 `memory/` 里的笔记。

- 直接告诉 AI 需要记住或更新什么信息
- 把文件放进 `tmp/`，让 AI 帮你整理
- 让 AI 把需要长期保存的文件移到 `assets/` 并加到相关笔记里
- 需要时再让 AI 帮你找回已有信息

## 常见说法

```text
请记一下，我的生日是 2000-01-01。
更新一下我的个人资料：我现在的手机号是 13800000000。
我把毕业证放进 tmp/ 了，帮我整理进记忆。
这两个文件是我的身份证正反面，帮我保存并链接到个人资料里。
帮我把这次签证申请要用的资料整理出来。
```

默认情况下，AI 会根据文件名和你的指令整理文件，不会主动读取文档内容；只有你明确要求时，才会进一步解析文件内容。

## 仓库里存的是什么

- `memory/`：由 agent 管理的 AI-safe Markdown 笔记
- `assets/`：长期保存的文件和附件
- `tmp/`：临时工作区，用来放待整理文件和中间产物
- `index/`：本地生成的检索索引

## 初始化

需要：

- Python `3.11+`
- `uv`
- `just`
- `fd`
- `ripgrep`

安装依赖：

```bash
uv sync
bun install
```

## OpenCode + Telegram Bot

快速开始：

1. 先把 `config.toml.example` 复制成 `config.toml`
2. 填好你的 Telegram bot 配置
3. 启动：

```bash
just serve
```

如果 `127.0.0.1:4096` 上已经有正在运行的 OpenCode server，会直接复用。

常用配置：

- `telegram.language`：同时控制界面文案和对话回复语言（`zh` 或 `en`）
- `telegram.persona_style`：调整 bot 的回复风格

## Telegram Bot

支持命令：

- `/help`
- `/new`
- `/model`
- `/reminders`

使用方式：

- 直接发普通文本和 bot 对话
- 上传文件后会保存到 `tmp/telegram/<date>/`
- 给上传文件带上 caption，可以立刻继续处理
- 如果你索要仓库里已有的图片或文件，bot 可以直接回传给你

## 命令

CLI 主要用于给 skill 提供检索和维护能力：

```bash
just list
just list --paths 10
just find --top 3 profile
just find --paths --top 1 bank account
just frontmatter memory/profile.md
just body memory/profile.md
just search passport
just search --files passport
just search --context 2 --max-count 1 passport
just index
just check
```

日常使用时优先直接对 AI 提需求；这些命令更适合在你想查看现有笔记、重建索引或校验仓库时使用。

`just find` 没命中，并不能证明没有相关笔记。`just find` 只查索引里的元数据，包括 frontmatter 里的 `summary`，但现在支持多个空格分隔的词，比如 `just find bank account`。如果只是想先拿到最可能的几个候选，优先用 `just find --top 3 ...`；如果是给 agent 后续继续处理，优先加 `--paths`，因为 path 更短、歧义更少、更省 token。建议把 `summary` 写成简短的一行正文概述，这样 agent 往往不用再打开正文。`just frontmatter NOTE` 现在默认只返回 `title`、`tags`、`aliases` 和 `summary` 这组精简元数据，适合作为低成本元数据读取。可以先用 `just list` 浏览候选项，如果还没有结果，再继续用 `just search`。如果你只想知道哪些笔记正文里提到了某个词，优先用 `just search --files ...`，不要直接打开正文；如果只需要看关键词附近的一小段上下文，优先用 `just search --context 2 --max-count 1 ...`。

为了减少检索噪音，建议每个 markdown 尽量只负责一类稳定主题，并把 tag 控制在较少数量。默认建议每条笔记不超过 3 个 tag，例如把 `memory/profile.md` 和 `memory/banking.md` 分开，而不是做成一个大而全的文件。相比固定长度上限，更应该按语义边界拆分：当一条笔记开始覆盖多个稳定检索主题时，就应该考虑拆成 sibling notes。`body` 属于更高成本的命令，只有在 `find`、`list`、`frontmatter` 或 `search --files` 已经缩小范围后再使用。`just check` 可能会输出关于 topic sprawl 的提醒性 warning，用来帮助你决定是否拆分笔记。

## 敏感信息

普通个人信息在你明确要求时可以直接记录。对密码、API key、private key、recovery code、银行卡号、CVV 这类高度敏感的信息，AI 应先提醒风险，再决定是否继续处理。

## 验证

```bash
just check
uv run pytest
```
