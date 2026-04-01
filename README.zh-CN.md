# 故障机器人

[English README](README.md)

一个本地优先的 Telegram bot，用来管理个人信息、整理资料、辅助填表和提醒。

## 主要用途

- 管理和检索个人信息
- 整理资料和文件
- 根据已记住的信息辅助填表
- 创建和管理提醒

## 权限级别

这个 bot 实际上有三档权限：

- `allowed user`：可以和 bot 对话、提问、查询非敏感信息；仓库应视为只读，而且要受隐私限制。不能读取或导出长期私密记忆、提醒详情、个人文件、密钥等敏感仓库数据，也不能修改长期记忆、文件、提醒数据或运行时配置。
- `trusted user`：可以读取和修改仓库里的记忆、文件、提醒和其他持久化数据，包括私密的长期记忆和提醒数据；但仍然不能要求修改 `config.toml` 或运行时配置。
- `admin user`：相当于 trusted user 再加管理权限。admin 可以要求修改 `config.toml` / 运行时配置，会收到启动问候和配置热重载通知，并且可以使用全部命令。

补充说明：

- 运行时会自动把 `admin_user_id` 视为 trusted，因此不必再重复写进 `trusted_user_ids`。
- `trusted user` 不需要再额外写进 `allowed_user_ids`。
- `admin user` 也不需要再额外写进 `trusted_user_ids` 或 `allowed_user_ids`。
- 不在 `allowed_user_ids`、`trusted_user_ids` 或 `admin_user_id` 中的用户，不能访问 bot。

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

一个典型配置是：

- `allowed_user_ids = [111111111]`
- `trusted_user_ids = [222222222]`
- `admin_user_id = 333333333`

如果你只使用 trusted/admin，`allowed_user_ids` 也可以留空。

```bash
just serve
```

如果 `127.0.0.1:4096` 上已经有 OpenCode 在运行，会直接复用。

## `config.toml` 字段说明

### `[telegram]`

- `bot_token`：从 BotFather 获取的 Telegram Bot Token。
- `allowed_user_ids`：允许和 bot 对话、但属于“受隐私限制的只读”权限的 Telegram 用户 ID 列表。可以问一般问题，但不应读取私密记忆、提醒详情、个人文件或密钥等敏感数据。如果你只使用 trusted/admin，也可以留空。
- `trusted_user_ids`：允许读取和修改记忆、文件、提醒和其他持久化仓库数据的用户 ID 列表。写在这里的用户不需要再额外写进 `allowed_user_ids`。
- `admin_user_id`：可选管理员用户 ID。admin 会自动被视为 trusted；此外还会收到启动 / 配置热重载通知，可以修改运行时配置，并能使用全部命令。admin 不需要再额外写进 `trusted_user_ids` 或 `allowed_user_ids`。
- `max_file_size_mb`：bot 接受的上传文件大小上限。
- `persona_style`：可选的人设 / 回复风格说明。
- `language`：默认回复语言，支持 `zh` 或 `en`。
- `waiting_message`：处理中显示的临时提示语。
- `waiting_message_candidates`：可选的轮换提示语列表。
- `waiting_message_rotation_ms`：轮换提示语的时间间隔。
- `reminder_message_timeout_ms`：生成提醒文案时的超时时间。
- `menu_page_size`：Telegram 菜单每页显示的项目数。

### `[paths]`

- `upload_subdir`：仓库 `tmp/` 目录下用于 Telegram 上传文件的子目录。
- `log_file`：主日志文件路径。
- `state_file`：本地状态文件路径，通常是 `.telegram-state.json`。

补充说明：

- 仓库根目录固定为当前仓库根目录。
- 临时工作目录固定为仓库下的 `tmp/`。

### `[opencode]`

- `base_url`：OpenCode 服务地址。

### `[dreaming]`

这组字段是内部调优项；正常使用时保持默认值即可。

## 命令与会话行为

- `/help`：所有已授权用户都可以使用。
- `/new`：allowed / trusted / admin 都可以使用。私聊里会重置该用户自己的会话；群组里会重置该群共享的会话。
- `/model`：仅 trusted / admin 可以使用。

会话隔离规则：

- 私聊：按用户隔离；
- 群组 / 超级群：按群隔离，共享一个会话；
- 最近上传文件的上下文缓存也按同样的作用域管理。

提醒行为：

- 提醒会记录所属用户 ID，并优先只发给该用户，而不是向所有 allowed 用户广播；
- 过期的一次性提醒会在启动时自动清理；
- idle dreaming 只有在真的改动了提醒、tmp 清理或记忆文件时，才会给 admin 发送 Telegram 摘要；如果什么都没变，就不会通知；
- 提醒文案会使用 `persona_style` 生成；
- 一次性提醒会在创建时预生成提醒文案；
- 周期性提醒只会为“下一条待发提醒”预生成文案，而且仅在下一次提醒落在 24 小时预热窗口内时才生成。

## 使用场景

- “记一下我的护照号 / 地址 / 银行信息。”
- “帮我把这些资料整理一下。”
- “根据我保存的信息帮我填这个表。”
- “提醒我明天早上 9 点提交申请。”
