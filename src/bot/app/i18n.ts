import { resolveUser } from "bot/operations/context/store";
import { state } from "./state";
import type { AppConfig } from "./types";

export type Locale = "zh-CN" | "en";

type Dictionary = {
  localeTag: string;
  strings: Record<string, string>;
};

const dictionaries: Record<Locale, Dictionary> = {
  "zh-CN": {
    localeTag: "zh-CN",
    strings: {
      choose_model: "请选择模型：",
      choose_provider: "请选择模型供应商：",
      choose_model_under_provider: "请选择 {provider} 的模型：",
      new_session: "已创建新会话：{sessionId}",
      model_not_found: "当前没有这个模型：{model}",
      model_switched: "已切换模型到：{model}",
      model_unavailable: "模型已不可用",
      fetch_models_failed: "获取模型列表失败：{error}",
      model_switch_failed: "切换模型失败：{error}",
      callback_model_switched: "已切换到 {model}",
      task_interrupted: "上一条任务已中止，改为处理你的最新消息。",
      generic_done: "已处理。",
      task_failed: "处理失败：{error}",
      send_failed: "我找到了相关文件，但这次发送失败了。",
      file_saved: "文件已保存。如果你希望我处理它，请继续发送具体要求。",
      file_upload_not_allowed: "当前账号只允许对话和查询记忆，不能上传或处理文件。",
      file_saved_and_processing: "{waiting_message}",
      file_processing_failed: "文件处理失败：{error}",
      file_processing_too_large_telegram_limit: "文件处理失败：Telegram 官方 Bot API 在未使用本地 Bot API 后端时，上传/下载文件大小限制约为 20MB。这个文件超过了该限制，请压缩、分割，或改发外部下载链接。",
      command_new: "新建会话",
      command_model: "查看或切换模型",
      command_help: "查看帮助",
      trusted_only_command: "这个命令仅限可信用户使用。",
      admin_only_command: "这个命令仅限管理员使用。",
      config_mutation_admin_only: "只有 admin 可以要求修改 config.toml 或运行时配置。",
      config_reload_notice: "config 已热重载。",
      config_reload_applied: "已生效: {keys}",
      config_reload_restart_required: "需重启: {keys}",
      config_reload_restart_hint: "这些项本次已保留当前运行值；详情见日志。",
      schedule_menu_title: "日程中心",
      schedule_menu_upcoming: "即将日程",
      schedule_menu_routine: "日常日程",
      schedule_menu_special: "特殊日程",
      schedule_menu_all: "全部日程",
      schedule_upcoming_summary: "未来 {days} 天，共 {count} 条",
      schedule_special_summary: "生日 {birthday} / 节日 {festival} / 纪念日 {anniversary} / 忌日 {memorial}",
      schedule_menu_special_birthday: "生日",
      schedule_menu_special_festival: "节日",
      schedule_menu_special_anniversary: "纪念日",
      schedule_menu_special_memorial: "忌日",
      schedule_delivery: "⏰ 日程\n{text}",
      schedule_none: "当前没有待处理日程。",
      schedule_list_title: "待处理日程（{count}）",
      schedule_prev: "⬅ 上一页",
      schedule_next: "下一页 ➡",
      schedule_delete: "删除",
      schedule_back: "返回列表",
      schedule_confirm_delete: "确认删除",
      schedule_cancel: "取消",
      schedule_missing: "日程不存在或已处理",
      schedule_delete_confirm: "确认删除这个日程？\n时间：{time}\n重复：{repeat}\n内容：{text}",
      schedule_deleted: "已删除日程",
      schedule_notification_now: "准时",
      schedule_detail_recipients: "对象：{value}",
      schedule_detail_time: "时间：{value}",
      schedule_detail_time_semantics: "时间语义：{value}",
      schedule_detail_timezone: "时区：{value}",
      schedule_detail_notifications: "通知：",
      schedule_detail_none: "- 无",
      schedule_time_semantics_absolute: "固定时间",
      schedule_time_semantics_local: "本地时间",
      schedule_recipients_unspecified: "未指定",
      outbound_sent_quote_header: "已发送给 {recipient}：",
      schedule_created_once: "在 {time}",
      schedule_created_daily: "每天 {time}",
      schedule_created_weekdays: "每个工作日 {time}",
      schedule_created_weekends: "每个周末 {time}",
      schedule_created_interval: "每 {every} {unit} 的 {time}",
      schedule_created_weekly: "每 {every} 周的 {days} {time}",
      schedule_created_monthly_day: "每 {every} 个月的 {day} 号 {time}",
      schedule_created_monthly_nth_weekday: "每 {every} 个月的{ordinal}{day} {time}",
      schedule_created_yearly: "每 {every} 年的 {month}/{day} {offset} {time}",
      schedule_created_lunar_yearly: "每年农历 {month}{day} {leapPolicy} {offset} {time}",
      schedule_offset_days_before: "前 {days} 天",
      schedule_unit_minute: "分钟",
      schedule_unit_hour: "小时",
      schedule_unit_day: "天",
      schedule_unit_week: "周",
      schedule_unit_month: "个月",
      schedule_unit_year: "年",
      ordinal_1: "第一个",
      ordinal_2: "第二个",
      ordinal_3: "第三个",
      ordinal_4: "第四个",
      ordinal_5: "第五个",
      "ordinal_-1": "最后一个",
      "schedule_lunar_leap_policy_same-leap-only": "（仅闰月年）",
      "schedule_lunar_leap_policy_prefer-non-leap": "（按平月）",
      schedule_lunar_leap_policy_both: "（闰月年平/闰月都提醒）",
      weekday_short_0: "周日",
      weekday_short_1: "周一",
      weekday_short_2: "周二",
      weekday_short_3: "周三",
      weekday_short_4: "周四",
      weekday_short_5: "周五",
      weekday_short_6: "周六",
    },
  },
  en: {
    localeTag: "en-US",
    strings: {
      choose_model: "Choose a model:",
      choose_provider: "Choose a model provider:",
      choose_model_under_provider: "Choose a model from {provider}:",
      new_session: "Created a new session: {sessionId}",
      model_not_found: "This model is not currently available: {model}",
      model_switched: "Switched model to: {model}",
      model_unavailable: "Model is no longer available",
      fetch_models_failed: "Failed to fetch model list: {error}",
      model_switch_failed: "Failed to switch model: {error}",
      callback_model_switched: "Switched to {model}",
      task_interrupted: "The previous task was interrupted. Processing your latest message instead.",
      generic_done: "Done.",
      task_failed: "Task failed: {error}",
      send_failed: "I found matching files, but sending them failed this time.",
      file_saved: "File saved. If you want me to process it, send a concrete instruction.",
      file_upload_not_allowed: "Your account is allowed to chat and query memory but cannot upload or process files.",
      file_saved_and_processing: "{waiting_message}",
      file_processing_failed: "File processing failed: {error}",
      file_processing_too_large_telegram_limit: "File processing failed: without a local Telegram Bot API server, the official Telegram Bot API only supports uploads/downloads up to about 20 MB. This file exceeds that limit. Please compress it, split it, or send an external download link instead.",
      command_new: "Create a new session",
      command_model: "View or switch model",
      command_help: "Get help",
      trusted_only_command: "This command is only available to trusted users.",
      admin_only_command: "This command is only available to admin.",
      config_mutation_admin_only: "Only the admin user may request changes to config.toml or runtime configuration.",
      config_reload_notice: "Config hot-reloaded.",
      config_reload_applied: "Applied: {keys}",
      config_reload_restart_required: "Restart required: {keys}",
      config_reload_restart_hint: "These fields kept their current runtime values for this run; see logs for details.",
      schedule_menu_title: "Schedules",
      schedule_menu_upcoming: "Upcoming",
      schedule_menu_routine: "Routine",
      schedule_menu_special: "Special",
      schedule_menu_all: "All",
      schedule_upcoming_summary: "Next {days} days, {count} item(s)",
      schedule_special_summary: "Birthdays {birthday} / Festivals {festival} / Anniversaries {anniversary} / Memorials {memorial}",
      schedule_menu_special_birthday: "Birthdays",
      schedule_menu_special_festival: "Festivals",
      schedule_menu_special_anniversary: "Anniversaries",
      schedule_menu_special_memorial: "Memorials",
      schedule_delivery: "⏰ Schedule\n{text}",
      schedule_none: "There are no pending schedules.",
      schedule_list_title: "Pending schedules ({count})",
      schedule_prev: "⬅ Previous",
      schedule_next: "Next ➡",
      schedule_delete: "Delete",
      schedule_back: "Back to list",
      schedule_confirm_delete: "Confirm delete",
      schedule_cancel: "Cancel",
      schedule_missing: "Schedule does not exist or was already handled",
      schedule_delete_confirm: "Delete this schedule?\nTime: {time}\nRepeat: {repeat}\nText: {text}",
      schedule_deleted: "Schedule deleted",
      schedule_notification_now: "On time",
      schedule_detail_recipients: "Recipients: {value}",
      schedule_detail_time: "Time: {value}",
      schedule_detail_time_semantics: "Time semantics: {value}",
      schedule_detail_timezone: "Time zone: {value}",
      schedule_detail_notifications: "Notifications:",
      schedule_detail_none: "- None",
      schedule_time_semantics_absolute: "Absolute time",
      schedule_time_semantics_local: "Local time",
      schedule_recipients_unspecified: "Unspecified",
      outbound_sent_quote_header: "Sent to {recipient}:",
      schedule_created_once: "at {time}",
      schedule_created_daily: "every day at {time}",
      schedule_created_weekdays: "every weekday at {time}",
      schedule_created_weekends: "every weekend at {time}",
      schedule_created_interval: "every {every} {unit} at {time}",
      schedule_created_weekly: "every {every} week(s) on {days} at {time}",
      schedule_created_monthly_day: "every {every} month(s) on day {day} at {time}",
      schedule_created_monthly_nth_weekday: "every {every} month(s) on the {ordinal} {day} at {time}",
      schedule_created_yearly: "every {every} year(s) on {month}/{day} {offset} at {time}",
      schedule_created_lunar_yearly: "every lunar year on {month}{day} {leapPolicy} {offset} at {time}",
      schedule_offset_days_before: "{days} day(s) before",
      schedule_unit_minute: "minute(s)",
      schedule_unit_hour: "hour(s)",
      schedule_unit_day: "day(s)",
      schedule_unit_week: "week(s)",
      schedule_unit_month: "month(s)",
      schedule_unit_year: "year(s)",
      ordinal_1: "first",
      ordinal_2: "second",
      ordinal_3: "third",
      ordinal_4: "fourth",
      ordinal_5: "fifth",
      "ordinal_-1": "last",
      "schedule_lunar_leap_policy_same-leap-only": "(leap month years only)",
      "schedule_lunar_leap_policy_prefer-non-leap": "(use non-leap month)",
      schedule_lunar_leap_policy_both: "(both regular and leap month in leap years)",
      weekday_short_0: "Sun",
      weekday_short_1: "Mon",
      weekday_short_2: "Tue",
      weekday_short_3: "Wed",
      weekday_short_4: "Thu",
      weekday_short_5: "Fri",
      weekday_short_6: "Sat",
    },
  },
};

export function formatTemplate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_match, key) => String(values[key] ?? `{${key}}`));
}

export function getDictionary(config: AppConfig): Dictionary {
  return dictionaries[config.bot.language];
}

export function t(config: AppConfig, key: string, values: Record<string, string | number> = {}): string {
  const dict = getDictionary(config);
  return formatTemplate(dict.strings[key] || key, values);
}

export function tForLocale(locale: Locale, key: string, values: Record<string, string | number> = {}): string {
  const dict = dictionaries[locale];
  return formatTemplate(dict.strings[key] || key, values);
}

export function localeFromTelegramLanguageCode(languageCode: string | undefined, fallback: Locale): Locale {
  const normalized = languageCode?.trim().toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "zh" || normalized.startsWith("zh-") || normalized.startsWith("zh_")) return "zh-CN";
  return "en";
}

export function userLocale(config: AppConfig, userId: number | undefined): Locale {
  if (!userId) return config.bot.language;
  const key = String(userId);
  const canonicalLanguageCode = resolveUser(config.paths.repoRoot, userId)?.languageCode;
  const runtimeLanguageCode = state.telegramUserCache[key]?.languageCode;
  return localeFromTelegramLanguageCode(canonicalLanguageCode || runtimeLanguageCode, config.bot.language);
}

export function tForUser(config: AppConfig, userId: number | undefined, key: string, values: Record<string, string | number> = {}): string {
  return tForLocale(userLocale(config, userId), key, values);
}

export function uiLocaleTag(config: AppConfig): string {
  return getDictionary(config).localeTag;
}
