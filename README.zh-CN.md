# Fill Free

[English README](README.md)

Fill Free 是一个本地优先的个人信息仓库：把可复用的信息和材料存一次，之后反复用于填表、申请和资料整理。

## 适合做什么

- 把可复用的个人信息记在 `memory/`
- 把相关文件统一放到 `assets/`
- 把待整理文件先放进 `workspace/`
- 用 `just` 命令快速查找已有内容

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

## 目录说明

- `memory/`：提交到仓库的 AI-safe Markdown 笔记
- `assets/`：长期保存的文件和附件
- `workspace/`：临时工作区
- `index/`：本地生成的索引

## 基本用法

1. 把可复用的信息写进 `memory/` 下的笔记。
2. 待整理的文件先放到 `workspace/`。
3. 需要长期保存的文件移到 `assets/`，并在笔记里加链接。
4. 新增、重命名、移动笔记，或修改标签后，运行 `just index`。
5. 运行 `just check` 做校验。

## 笔记格式

`memory/` 下的笔记建议这样写：

```md
---
title: "个人资料"
date: "2026-03-23"
tags: ["profile"]
aliases: ["基本信息"]
---

我的生日是 1993-09-06。
```

必填字段：`title`、`date`、`tags`。

## 常用命令

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

推荐顺序：

1. `just find QUERY` 或 `just tag TAG`
2. `just list`
3. `just frontmatter NOTE` 或 `just body NOTE`
4. 需要全文搜索时再用 `just search PATTERN`

## 敏感信息

不要随手保存高度敏感的信息，例如密码、API key、private key、recovery code、银行卡号、CVV。普通个人信息如果你明确希望长期复用，可以直接记录。

## 验证

```bash
just check
uv run pytest
```
