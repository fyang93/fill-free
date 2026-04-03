# 故障机器人

[English README](README.md)

一个本地优先的 Telegram bot，用于个人记忆、文件、提醒，以及轻量的消息转达流程。

它运行在 pi SDK 上，并把 bot 专用的 pi 配置放在 `.pi/bot/` 下。

## 它能做什么

- 记住并查询个人事实信息
- 整理上传的文件和资料
- 创建和管理提醒
- 向已授权用户或已知群聊发送消息或提醒

## 快速开始

```bash
cp config.toml.example config.toml
cp .env.example .env
just install
just serve
```

## 配置

至少填写：

- `telegram.bot_token`
- `telegram.allowed_user_ids` 和/或 `telegram.trusted_user_ids`
- 可选 `telegram.admin_user_id`
- `.env` 里的 `OPENROUTER_API_KEY`

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

bot 会使用项目内的 pi 配置文件：

- `.pi/bot/models.json`：bot 使用的模型/提供商定义
- `.pi/bot/settings.json`：bot 默认 provider/model
- `.pi/bot/mcp.json`：bot 的 MCP server 配置

当前默认方案使用 OpenRouter，并通过 `OPENROUTER_API_KEY` 提供凭据。

开发时如需监听文件变化，可用：

```bash
bun run telegram:dev
```

## Telegram 使用前提

- 任何需要接收 bot 私聊消息的用户，都必须先主动和 bot 私聊一次。
- 如果要在群里使用这个 bot，需要去 **BotFather** 把该 bot 的 **Group Privacy** 关闭。

## 权限级别

- `allowed user`：可以和 bot 对话并使用基础功能
- `trusted user`：可以读取和修改记忆、文件、提醒及其他持久化数据
- `admin user`：在 trusted 的基础上拥有管理权限

不在 `allowed_user_ids`、`trusted_user_ids` 或 `admin_user_id` 中的用户，无法访问 bot。

admin 也可以对某个 `@username` 做临时授权。对方需要在临时授权过期前主动私聊 bot，一旦成功，bot 会自动把对方加入 `allowed_user_ids`。

## 主要目录

- `memory/`：人类可读的长期记忆笔记
- `assets/`：长期保存的文件
- `system/`：由代码管理的状态，例如 reminders、Telegram identity/state
- `tmp/`：临时上传和工作文件

## 使用示例

- “记一下我的护照号。”
- “我的家庭住址是什么？”
- “提醒我明天早上 9 点提交申请。”
- “发给 @kyogokuame：晚饭好了。”
- “把这条消息发到家庭群。”

## 命令

- `/help`
- `/new`
- `/model`（仅 trusted/admin）
- `/dream`（仅 admin）
