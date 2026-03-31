import type { AppConfig } from "./types";

type Locale = "zh" | "en";

type Dictionary = {
  localeTag: string;
  replyLanguage: string;
  strings: Record<string, string>;
};

const dictionaries: Record<Locale, Dictionary> = {
  zh: {
    localeTag: "zh-CN",
    replyLanguage: "Chinese",
    strings: {
      help_text: [
        "The Defect Bot Telegram 入口已就绪。",
        "",
        "你可以直接用自然语言让我：",
        "- 查询已保存的信息",
        "- 记录或更新个人信息",
        "- 整理上传到 tmp/ 的文件",
        "- 按 memory-agent 工作流处理资料",
        "",
        "上传文件后会自动保存到 tmp/telegram/<date>/ 下。",
        "如果文件带说明文字，我会继续自动处理。",
        "",
        "可用命令：",
        "/help - 查看帮助",
        "/new - 新建会话",
        "/model - 查看或切换模型",
        "/model <provider/model> - 切换模型",
        "/reminders - 查看提醒列表",
      ].join("\n"),
      choose_model: "请选择模型：",
      new_session: "已创建新会话：{sessionId}",
      model_not_found: "OpenCode 当前没有这个模型：{model}",
      model_switched: "已切换模型到：{model}",
      model_unavailable: "模型已不可用",
      fetch_models_failed: "获取模型列表失败：{error}",
      model_switch_failed: "切换模型失败：{error}",
      callback_model_switched: "已切换到 {model}",
      task_interrupted: "上一条任务已中止，改为处理你的最新消息。",
      generic_done: "已处理。",
      task_failed: "处理失败：{error}",
      send_failed: "我找到了相关文件，但这次发送失败了。",
      file_saved: "文件已保存。\npath: {path}\n如果你希望我处理它，请继续发送具体要求。",
      file_saved_and_processing: "文件已保存到 {path}。{waiting_message}",
      file_processing_failed: "文件处理失败：{error}",
      command_help: "查看帮助和使用说明",
      command_new: "新建会话",
      command_model: "查看或切换模型",
      command_reminders: "查看和管理提醒",
      reminder_delivery: "⏰ 提醒\n{text}",
      reminder_none: "当前没有待提醒事项。",
      reminder_list_title: "待提醒事项（{count}）",
      reminder_prev: "⬅ 上一页",
      reminder_next: "下一页 ➡",
      reminder_delete: "删除",
      reminder_back: "返回列表",
      reminder_confirm_delete: "确认删除",
      reminder_cancel: "取消",
      reminder_missing: "提醒不存在或已处理",
      reminder_detail: "⏰ 提醒详情\n时间：{time}\n内容：{text}",
      reminder_delete_confirm: "确认删除这个提醒？\n时间：{time}\n内容：{text}",
      reminder_deleted: "已删除提醒",
      reminder_created: "好的，我会在 {time} 提醒你：{text}",
    },
  },
  en: {
    localeTag: "en-US",
    replyLanguage: "English",
    strings: {
      help_text: [
        "The Defect Bot Telegram entry is ready.",
        "",
        "You can ask it in natural language to:",
        "- retrieve saved information",
        "- record or update personal information",
        "- organize files uploaded under tmp/",
        "- process materials according to the memory-agent workflow",
        "",
        "Uploaded files are saved under tmp/telegram/<date>/.",
        "If a file includes a caption, the bot continues processing automatically.",
        "",
        "Commands:",
        "/help - show help",
        "/new - create a new session",
        "/model - view or switch model",
        "/model <provider/model> - switch model",
        "/reminders - show reminders",
      ].join("\n"),
      choose_model: "Choose a model:",
      new_session: "Created a new session: {sessionId}",
      model_not_found: "OpenCode does not currently provide this model: {model}",
      model_switched: "Switched model to: {model}",
      model_unavailable: "Model is no longer available",
      fetch_models_failed: "Failed to fetch model list: {error}",
      model_switch_failed: "Failed to switch model: {error}",
      callback_model_switched: "Switched to {model}",
      task_interrupted: "The previous task was interrupted. Processing your latest message instead.",
      generic_done: "Done.",
      task_failed: "Task failed: {error}",
      send_failed: "I found matching files, but sending them failed this time.",
      file_saved: "File saved.\npath: {path}\nIf you want me to process it, send a concrete instruction.",
      file_saved_and_processing: "File saved to {path}. {waiting_message}",
      file_processing_failed: "File processing failed: {error}",
      command_help: "Show help and usage",
      command_new: "Create a new session",
      command_model: "View or switch model",
      command_reminders: "View and manage reminders",
      reminder_delivery: "⏰ Reminder\n{text}",
      reminder_none: "There are no pending reminders.",
      reminder_list_title: "Pending reminders ({count})",
      reminder_prev: "⬅ Previous",
      reminder_next: "Next ➡",
      reminder_delete: "Delete",
      reminder_back: "Back to list",
      reminder_confirm_delete: "Confirm delete",
      reminder_cancel: "Cancel",
      reminder_missing: "Reminder does not exist or was already handled",
      reminder_detail: "⏰ Reminder details\nTime: {time}\nText: {text}",
      reminder_delete_confirm: "Delete this reminder?\nTime: {time}\nText: {text}",
      reminder_deleted: "Reminder deleted",
      reminder_created: "Okay, I will remind you at {time}: {text}",
    },
  },
};

export function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => String(values[key] ?? `{${key}}`));
}

export function getDictionary(config: AppConfig): Dictionary {
  return dictionaries[config.telegram.language];
}

export function t(config: AppConfig, key: string, values: Record<string, string | number> = {}): string {
  const dict = getDictionary(config);
  return formatTemplate(dict.strings[key] || key, values);
}

export function uiLocaleTag(config: AppConfig): string {
  return getDictionary(config).localeTag;
}

export function replyLanguageName(config: AppConfig): string {
  return getDictionary(config).replyLanguage;
}
