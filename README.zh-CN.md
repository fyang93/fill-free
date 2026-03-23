# Fill Free

[English README](README.md)

Fill Free 是一个本地优先的个人信息仓库：把信息记录一次，之后就能反复用于填表、申请、资料整理等场景。仓库中提交的内容只保存为 AI-safe 的 Markdown；`workspace/` 是给用户和 AI 共用的临时工作区，用来放待整理文件、处理中间产物或短期输出文件；AI 默认不会主动解析这些文件内容，而是根据文件名和用户指示把它们整理到集中存放的文档目录，并在 `memory/` 里的 Markdown 中写入对应链接；只有用户明确要求时，AI 才会进一步处理文件内容；repo-local 的 `memory-agent` skill 负责“记一下/保存/整理到记忆里”、填表前资料准备等长期记忆决策。

## 核心原则

- `memory/` 里的 Markdown 笔记是可提交的真源；`index/` 是本地生成状态
- `index/` 里放本地生成的索引和热度统计
- 整理后的文件集中放在 `assets/` 下
- 记录下来的信息应该能被反复用于不同填表流程
- 元数据检索优先走生成好的索引；`fd` 和 `rg` 继续保留给重建和正文搜索
- 只在非常敏感的数据上提醒用户，例如密码、API key、银行卡号、CVV

## 目录结构

```text
.
├── .agents/skills/memory-agent/SKILL.md
├── index/
├── memory/
├── assets/
├── workspace/
├── justfile
├── pyproject.toml
└── src/memory_agent/
```

- `memory/`：存放提交到仓库的 AI-safe Markdown
- `index/`：由笔记重建出来的 JSONL/JSON 索引
- `assets/`：集中存放整理后的文档和附件
- `workspace/`：给用户和 AI 共用的临时工作区，用来放输入文件、整理结果和中间输出
- `src/memory_agent/`：repo-local `memory-agent` CLI 与 skill 的 Python 包

## 依赖

- `uv`
- Python `3.11+`
- `just`
- `fd`
- `ripgrep`

如果你使用 Nix，可以直接用仓库里的 `flake.nix`。

## 初始化

```bash
uv sync
```

## 笔记格式

笔记放在 `memory/` 下，格式类似：

```md
---
title: "高中经历"
date: "2026-03-23"
tags: ["education", "profile"]
aliases: ["高中"]
summary: "可选，不参与默认检索匹配。"
---

我高中就读于杭州第二中学。
```

repo-local 的 `memory-agent` skill 负责长期记忆的检索与写入决策，包括用户明确要求“记一下/保存”的事项。CLI 和 `just` 命令提供仓库内的检索、索引重建和 frontmatter 搜索，不会把普通闲聊自动写成记忆；偏好、习惯或情绪都不会默认记录，除非用户明确要求。

姓名、生日、性别、手机号、教育经历、工作经历，以及各种会在不同申请表里重复出现的信息，都可以直接写进提交到仓库的 Markdown。

## 能力边界

- CLI 当前实现仓库内检索、索引维护、热度记录和校验：`list`、`find`、`tag`、`frontmatter`、`body`、`search`、`index`、`use`、`check`
- 是否该写入记忆、如何把 `workspace/` 文件整理成笔记和 `assets/` 链接、以及如何支撑后续填表任务，这些决策属于 skill / agent workflow
- 仓库目前没有提供“创建笔记 / 编辑笔记 / 自动搬运文件 / 自动补链接”的一等 CLI 命令
- 如果是 PDF、表格等重文档任务，这个仓库主要负责记忆沉淀和文件组织，解析与写回应交给其他工具或 skill；Fill Free 负责提供可复用的个人信息和资料上下文

当前 skill 约定的写作规则：

- 正文默认中文
- 标题默认中文
- 标签统一为英文 `kebab-case`
- 路径名优先使用英文，例如 `memory/profile.md`、`assets/imgs/id-card-front.jpg`

## 快速示例

- 直接记非私密事实：`帮我记一下这首歌：晴天。`
- 直接记录可变换的个人事实：`请记一下，我的生日是 1993-09-06。` -> 笔记里可以直接写日期，方便 AI 之后按不同场景输出不同格式
- 普通个人事实按需直接记录：`请记一下我的身份证号。`
- 非常敏感的数据先提醒：`请保存我的卡 CVV。` -> AI 应先提醒这类内容不适合直接在聊天里发送，只有用户明确坚持时才继续
- 不读内容先整理 `workspace/` 文件：`我把毕业证放进 workspace/ 了，帮我整理进记忆。` -> AI 默认把文件移动到 `assets/`，在笔记里加链接；只有用户明确要求保留原件时才会复制而不是移动
- 先输出到工作区：`帮我把这些材料整理一下，结果先输出到 workspace/。` -> AI 默认把临时结果写到 `workspace/`
- 整理可复用填表资料：`帮我把这次签证申请要用到的资料和个人信息整理出来。` -> AI 可以结合已记录的信息和链接文件，准备后续填表所需的材料包

## 命令总览

```bash
just list [N|all]
just find QUERY
just tag TAG
just frontmatter NOTE
just body NOTE
just search PATTERN
just index
just use NOTE
just check
```

## 索引与检索

元数据检索现在优先走 `index/` 下的生成索引。

- `index/notes.jsonl` 里每行保存一条面向查询的笔记元信息
- `index/tags.json` 保存 tag 到 note 的倒排索引
- `index/state.json` 保存索引时的文件快照，用来做 freshness 检查
- `index/usage.json` 保存 `use_count`、`last_used_at` 这类运行时热度信息
- `just index` 会尽量按差分同步索引，必要时回退到全量重建，并顺手清理已删除笔记对应的 usage 记录
- `just list`、`just find`、`just tag` 会对比当前 note 的路径和文件时间戳与 `state.json`，如果索引看起来过期就静默同步
- `just use NOTE` 只在某条笔记真的被用于具体任务时调用，用来增加热度
- `fd` 继续适合做重建时的文件发现，`rg` 继续适合正文搜索，但元数据命令不再需要每次都全量扫描所有笔记
- 目前 `just check` 只校验笔记可解析、tag 格式正确；它还不会把文档里写到的每一条格式约定都强制执行

`state.json` 结构示例：

```json
{
  "indexed_at": "2026-03-24T12:34:56Z",
  "note_count": 2,
  "snapshot": {
    "memory/profile.md": {"mtime_ns": 1711283696000000000, "size": 342},
    "memory/education.md": {"mtime_ns": 1711283701000000000, "size": 518}
  }
}
```

推荐在发生会影响索引的变更后这样维护：

1. 在 `memory/` 下新增、重命名、移动、删除笔记，或修改会进入索引的 frontmatter 字段，例如 `title`、`tags`、`aliases`
2. 运行 `just index`
3. 运行 `just check`

## 推荐检索顺序

优先使用最省 token 的命令：

1. `just find QUERY`
2. `just tag TAG`
3. `just list` / `just list 10` / `just list 100`
4. `just frontmatter NOTE`
5. `just body NOTE`
6. `just search PATTERN`

`just list`、`just find`、`just tag` 会优先读取 `index/`；`just search` 仍然是正文原文搜索的兜底。

## 热度排序

- `just list` 默认按 `use_count` 倒序，再按标题排序
- `just use NOTE` 只应在某条笔记真的被用于一个具体任务时调用，而不是普通搜索或查看时调用
- 如果 `usage.json` 不存在或为空，`just list` 会退回到按标题排序
- 只改正文 body 时通常不需要手动跑 `just index`，不过元数据命令在看到文件时间戳比索引更新时，仍可能顺手刷新索引

## 高敏信息规则

这个仓库不再提供单独的本地 secrets 工作流，记忆默认直接写在笔记里或通过文件链接表示。

- 不要因为一般个人信息就频繁打断用户。
- 只对非常敏感的数据提醒，例如：

- API key
- token
- password
- private key
- recovery code
- credit card number
- CVV

- 提醒时要简短说明：这类值一旦发给 AI，可能进入 AI 上下文或仓库历史。
- 如果用户没有明确坚持，就不要存。
- 如果用户明确坚持，再谨慎继续，并且只处理完成任务所必需的最少内容。
- 除非任务确实需要，不要把原始值重复回显给用户。

## Workspace 与外部 Skill 协作

`workspace/` 主要是一个临时工作区，不是长期存储区。整理后的文件默认集中放到 `assets/` 下，而不是散落在各个 Markdown 附近；但如果用户明确要求保留输出在工作区，也可以继续放在 `workspace/`。

典型用法是：

- 用户把毕业证、成绩单、申请表、截图等文件先放进 `workspace/`
- 用户也可以要求 AI 先把整理结果、草稿或中间文件输出到 `workspace/`
- AI 默认根据文件名和用户指示把这些文件移动到 `assets/` 下合适的英文子目录，例如 `assets/imgs/`、`assets/docs/` 或其他更合适的路径；只有用户明确要求保留 `workspace/` 原件时才会改为复制
- AI 在相关笔记里写入 Markdown 链接，例如在 `memory/profile.md` 里写 `[身份证正面照片](../assets/imgs/id-card-front.jpg)`
- 只有用户明确要求时，AI 才会进一步读取文件内容或提取信息

Fill Free 本身仍然不直接实现 PDF、Excel 或表格文件的复杂读写；这类场景可以配合外部 skill：

- 本仓库负责资料沉淀、集中存放文件、检索，以及为后续表单提供可复用的个人信息上下文
- 外部 skill 负责文件解析、结构化提取和写回
- 信息缺失时由 AI 向用户逐项确认

## 验证

运行完整测试：

```bash
uv run pytest
```
