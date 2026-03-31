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

- `memory/`：AI-safe Markdown 笔记
- `assets/`：长期保存的文件和附件
- `tmp/`：临时工作区，用来放待整理文件和中间产物
- `index/`：Telegram bot 运行时状态

## 初始化

需要：

- `bun`
- `just`
- `fd`
- `ripgrep`

安装依赖：

```bash
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
- `telegram.waiting_message`：任务处理中先显示的等待文案
- `telegram.waiting_message_candidates`：可选的等待文案列表；非空时按配置的轮换间隔随机替换
- `telegram.waiting_message_rotation_ms`：等待文案列表的轮换间隔，默认 `5000`
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

顶层 `justfile` 现在刻意保持极简：

```bash
just serve
```

检索时优先直接用标准 shell 工具：

```bash
fd . memory
rg -n "樱桃|郭旸" memory
rg -n -C 2 "三井住友|SMBC" memory
```

日常使用时优先直接对 AI 提需求。这个仓库现在更接近 pi 的极简哲学：默认暴露更少的命令面，只依赖 `fd`、`rg` 和直接读文件来完成大部分检索。frontmatter 仍然保留，用来提供轻量结构、别名和摘要；但真正回答问题时，应该优先依赖正文搜索，而不是额外维护一套元数据索引。

为了减少检索噪音，建议每个 markdown 尽量只负责一类稳定主题，并把 tag 控制在较少数量。默认建议每条笔记不超过 3 个 tag，例如把 `memory/profile.md` 和 `memory/banking.md` 分开，而不是做成一个大而全的文件。相比固定长度上限，更应该按语义边界拆分：当一条笔记开始覆盖多个稳定检索主题时，就应该考虑拆成 sibling notes。

## 敏感信息

普通个人信息在你明确要求时可以直接记录。对密码、API key、private key、recovery code、银行卡号、CVV 这类高度敏感的信息，AI 应先提醒风险，再决定是否继续处理。

