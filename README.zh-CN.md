# Mamory

[English README](README.md)

这是一个面向 AI 工作流的本地优先笔记与个人资料仓库。

仓库中提交的内容只保存为 AI-safe 的 Markdown；真实敏感值保存在本地 `secrets.toml`；AI 和人都通过少量 `just` 命令来低成本检索、查看和最终展开占位符。

## 核心原则

- `memory/` 里只放可提交的 Markdown 笔记
- 真实值只放本地 `secrets.toml`
- 笔记里用 `{{education.high_school.name}}` 这类占位符
- `index/` 里是轻量索引，用来省 token
- 只有 `just body` 会增加本地使用次数
- 最终回答时再用 `just expand` 本地展开真实值

## 目录结构

```text
.
├── .agents/skills/notes-agent/SKILL.md
├── .local/
├── index/
├── memory/
├── workspace/
├── justfile
├── pyproject.toml
├── secrets.toml.example
└── src/notes_agent/
```

- `memory/`：存放提交到仓库的 AI-safe Markdown
- `index/`：生成出来的笔记索引和标签倒排索引
- `.local/`：本地忽略状态，比如 usage 计数
- `workspace/`：给用户或外部 skill 放本地文件的工作区

## 依赖

- `uv`
- Python `3.14`
- `just`
- `fd`
- `ripgrep`

如果你使用 Nix，可以直接用仓库里的 `flake.nix`。

## 初始化

```bash
uv sync
cp secrets.toml.example secrets.toml
```

然后在本地填写 `secrets.toml`，不要提交它。

## 笔记格式

笔记放在 `memory/` 下，格式类似：

```md
---
title: "高中经历"
date: "2026-03-23"
tags: ["education", "profile"]
aliases: ["高中"]
summary: "可选，不进入明文索引。"
---

我的高中是 {{education.high_school.name}}。
```

当前 skill 约定的写作规则：

- 正文默认中文
- 标题默认中文
- 标签统一为英文 `kebab-case`

## 命令总览

```bash
just index
just list [N|all]
just find QUERY
just tag TAG
just frontmatter NOTE
just body NOTE
just search PATTERN
just secrets-add [NOTE]
just secrets-set KEY
just secrets-fill NOTE
just expand
just check
```

## 推荐检索顺序

优先使用最省 token 的命令：

1. `just find QUERY`
2. `just tag TAG`
3. `just list` / `just list 10` / `just list 100`
4. `just frontmatter NOTE`
5. `just body NOTE`
6. `just search PATTERN`

## Secret 工作流

1. 在笔记中写占位符
2. 运行 `just secrets-add [NOTE]` 注册缺失 key
3. 用 `just secrets-set KEY` 或 `just secrets-fill NOTE` 填入普通真实值
4. 先生成仍带占位符的最终答案
5. 最后把文本管道给 `just expand`

示例：

```bash
printf '你的高中是 {{education.high_school.name}}。\n' | just expand
```

## 高敏信息规则

repo-local skill 明确禁止在普通 AI 流程里索取或填写高敏感值，例如：

- API key
- token
- password
- private key
- recovery code
- credit card number
- CVV

这些值应当由用户在 AI 流程之外手动处理。

## 外部 Skill 协作

本仓库本身不负责 PDF、Excel 或表格文件的读写。

组合方式是：

- 本仓库提供资料检索与占位符展开能力
- 外部 skill 负责文件解析和写回
- 信息缺失时由 AI 向用户逐项确认

## 验证

运行完整测试：

```bash
uv run pytest
```
