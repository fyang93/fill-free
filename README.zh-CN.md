# Fill Free

[English README](README.md)

Fill Free 是一个本地优先的个人信息仓库，但核心用法不是手动写笔记，而是通过 `memory-agent` 让 AI 帮你管理可复用的个人信息、资料链接和文档整理结果，方便后续填表、申请和材料准备。

## 怎么使用

一般情况下，你不需要手动编辑 `memory/` 里的笔记。

- 直接告诉 AI 需要记住或更新什么信息
- 把文件放进 `workspace/`，让 AI 帮你整理
- 让 AI 把需要长期保存的文件移到 `assets/` 并加到相关笔记里
- 需要时再让 AI 帮你找回已有信息

## 常见说法

```text
请记一下，我的生日是 2000-01-01。
更新一下我的个人资料：我现在的手机号是 13800000000。
我把毕业证放进 workspace/ 了，帮我整理进记忆。
这两个文件是我的身份证正反面，帮我保存并链接到个人资料里。
帮我把这次签证申请要用的资料整理出来。
```

默认情况下，AI 会根据文件名和你的指令整理文件，不会主动读取文档内容；只有你明确要求时，才会进一步解析文件内容。

## 仓库里存的是什么

- `memory/`：由 agent 管理的 AI-safe Markdown 笔记
- `assets/`：长期保存的文件和附件
- `workspace/`：临时工作区，用来放待整理文件和中间产物
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
```

## 命令

CLI 主要用于给 skill 提供检索和维护能力：

```bash
just list
just find profile
just tag profile
just frontmatter memory/profile.md
just body memory/profile.md
just search passport
just index
just check
```

日常使用时优先直接对 AI 提需求；这些命令更适合在你想查看现有笔记、重建索引或校验仓库时使用。

## 敏感信息

普通个人信息在你明确要求时可以直接记录。对密码、API key、private key、recovery code、银行卡号、CVV 这类高度敏感的信息，AI 应先提醒风险，再决定是否继续处理。

## 验证

```bash
just check
uv run pytest
```
