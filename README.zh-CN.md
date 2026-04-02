# 故障机器人

[English README](README.md)

一个本地优先的 Telegram bot，用于个人记忆、资料管理和提醒。

## 核心功能

- 记住并查询个人信息
- 整理上传的资料和文件
- 根据已保存的信息辅助填表
- 创建和管理提醒
- 向已授权用户或已知群聊发送消息与提醒

## 快速开始

### 1. 安装依赖

可以使用 Nix，或者手动安装：

- `bun`
- `just`
- `fd`
- `ripgrep`

然后执行：

```bash
just install
```

### 2. 配置 bot

复制配置文件：

```bash
cp config.toml.example config.toml
```

至少填写：

- `bot_token`
- `allowed_user_ids` 和/或 `trusted_user_ids`
- 可选 `admin_user_id`

典型配置：

```toml
[telegram]
bot_token = "YOUR_TELEGRAM_BOT_TOKEN"
allowed_user_ids = [111111111]
trusted_user_ids = [222222222]
admin_user_id = 333333333

[bot]
language = "zh"
persona_style = "模仿杀戮尖塔里的故障机器人说话。"
reminder_message_timeout_ms = 60000
prompt_task_timeout_ms = 60000
default_timezone = "Asia/Tokyo"
```

一些常用的可选项：

- `bot.reminder_message_timeout_ms`：提醒消息生成超时时间，默认 `60000`
- `bot.prompt_task_timeout_ms`：普通消息处理超时时间，默认 `60000`
- `bot.default_timezone`：用户未显式提供时使用的默认时区

### 3. 启动

```bash
just serve
```

## Telegram 侧注意事项

- 任何需要接收 bot 私聊消息的用户，都必须先主动和 bot 私聊一次。
- 如果要在群里使用这个 bot，需要去 **BotFather** 把该 bot 的 **Group Privacy** 关闭。

## 权限级别

- `allowed user`：可以和 bot 对话并使用基础功能
- `trusted user`：可以读取和修改记忆、文件、提醒及其他持久化数据
- `admin user`：在 trusted 的基础上拥有管理权限

不在 `allowed_user_ids`、`trusted_user_ids` 或 `admin_user_id` 中的用户，无法访问 bot。

admin 也可以对某个 `@username` 做临时授权。对方需要在临时授权过期前主动私聊 bot，一旦成功，bot 会自动把对方加入 `allowed_user_ids`。

## 主要目录结构

- `memory/`：人类可读的长期记忆笔记
- `assets/`：长期保存的文件
- `system/`：由代码管理的持久化数据，例如 reminders、Telegram identity/state
- `tmp/`：临时上传和工作文件

## 使用示例

- “记一下我的护照号。”
- “我的家庭住址是什么？”
- “根据我保存的信息帮我填这个表。”
- “提醒我明天早上 9 点提交申请。”
- “发给 @kyogokuame：晚饭好了。”
- “提醒 @kyogokuame 明晚 8 点吃药。”
- “把这条消息发到家庭群。”
- “明天上午 10 点提醒项目群。”

## 命令

- `/help`
- `/new`
- `/model`（仅 trusted/admin）
