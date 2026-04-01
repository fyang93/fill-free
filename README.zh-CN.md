# The Defect Bot

[English README](README.md)

一个本地优先的 Telegram bot，用来管理个人信息、整理资料、辅助填表和提醒。

## 主要用途

- 管理和检索个人信息
- 整理资料和文件
- 根据已记住的信息辅助填表
- 创建和管理提醒

## 环境准备

可以用 Nix，也可以手动安装依赖。

### 方式一：Nix

如果你使用 `direnv`，进入仓库目录时通常会自动启用开发环境。
这种情况下通常直接运行：

```bash
just install
```

如果没有使用 `direnv`，则手动进入 Nix 环境：

```bash
nix develop
just install
```

### 方式二：手动安装

安装：

- `bun`
- `just`
- `fd`
- `ripgrep`

然后执行：

```bash
just install
```

## 使用

1. 复制 `config.toml.example` 为 `config.toml`
2. 填好 Telegram bot 配置
3. 启动

```bash
just serve
```

如果 `127.0.0.1:4096` 上已经有 OpenCode 在运行，会直接复用。

## `config.toml` 字段说明

### `[telegram]`

- `bot_token`：从 BotFather 获取的 Telegram Bot Token。
- `allowed_user_ids`：允许和 bot 对话的 Telegram 用户 ID 列表。
- `trusted_user_ids`：允许修改记忆、文件和其他持久化仓库数据的用户 ID 列表。
- `admin_user_id`：可选管理员用户 ID。只有这个用户会收到启动问候，也只有这个用户可以使用 `/new`、`/model` 这类管理命令。
- `max_file_size_mb`：bot 接受的上传文件大小上限。
- `persona_style`：可选的人设 / 回复风格说明。
- `language`：默认回复语言，支持 `zh` 或 `en`。
- `waiting_message`：处理中显示的临时提示语。
- `waiting_message_candidates`：可选的轮换提示语列表。
- `waiting_message_rotation_ms`：轮换提示语的时间间隔。
- `reminder_message_timeout_ms`：生成提醒文案时的超时时间。
- `menu_page_size`：Telegram 菜单每页显示的项目数。

### `[paths]`

- `repo_root`：bot 使用的仓库根目录。
- `tmp_dir`：上传文件等临时工作目录。
- `upload_subdir`：`tmp_dir` 下用于 Telegram 上传文件的子目录。
- `log_file`：主日志文件路径。
- `state_file`：本地状态文件路径，通常是 `.telegram-state.json`。

### `[opencode]`

- `base_url`：OpenCode 服务地址。

### `[dreaming]`

这组字段是内部调优项；正常使用时保持默认值即可。

## 使用场景

- “记一下我的护照号 / 地址 / 银行信息。”
- “帮我把这些资料整理一下。”
- “根据我保存的信息帮我填这个表。”
- “提醒我明天早上 9 点提交申请。”
