import type { ScheduleEvent } from "./types";

export function buildScheduledTaskPrompt(title: string, note?: string): string {
  const trimmedNote = note?.trim();
  if (trimmedNote) return trimmedNote;
  const trimmedTitle = title.trim();
  if (/新闻|资讯|快讯|日报|简报|news/i.test(trimmedTitle)) {
    return `联网获取最近一天的重要新闻资讯，并围绕“${trimmedTitle}”整理成简洁摘要。优先覆盖最值得关注的要点。`;
  }
  if (/天气|weather/i.test(trimmedTitle)) {
    return `联网获取最新天气信息，并围绕“${trimmedTitle}”整理成简洁有用的播报。`;
  }
  if (/汇率|exchange rate|外汇/i.test(trimmedTitle)) {
    return `联网获取最新汇率信息，并围绕“${trimmedTitle}”整理成简洁摘要。`;
  }
  if (/股价|股票|行情|price|stock/i.test(trimmedTitle)) {
    return `联网获取最新市场信息，并围绕“${trimmedTitle}”整理成简洁摘要。`;
  }
  return `围绕“${trimmedTitle}”生成一份最新、简洁、有用的定时内容；如果任务依赖最新外部信息，请先联网获取后再总结。`;
}

export function scheduledTaskPromptForEvent(event: ScheduleEvent): string {
  return buildScheduledTaskPrompt(event.title, event.note);
}
