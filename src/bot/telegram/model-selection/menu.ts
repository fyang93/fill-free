import { InlineKeyboard } from "grammy";

export const MODEL_CALLBACK_PREFIX = "model:";

function compactLabel(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}

export function compactModelLabel(model: string): string {
  return compactLabel(model, 48);
}

export function modelIdLabel(model: string): string {
  const index = model.indexOf("/");
  const label = index >= 0 ? model.slice(index + 1) : model;
  return compactModelLabel(label);
}

export function compactProviderLabel(provider: string): string {
  return compactLabel(provider, 32);
}

export function providersFromModels(models: string[]): string[] {
  return Array.from(new Set(models.map((model) => model.split("/", 1)[0]))).sort((a, b) => a.localeCompare(b));
}

export function modelsForProvider(models: string[], provider: string): string[] {
  return models.filter((model) => model.startsWith(`${provider}/`));
}

function buildPagedKeyboard(items: Array<{ label: string; data: string }>, pageSize: number, page: number, navPrefix: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const currentPage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = currentPage * safePageSize;
  const pageItems = items.slice(start, start + safePageSize);

  pageItems.forEach((item) => keyboard.text(item.label, item.data).row());
  if (totalPages > 1) {
    if (currentPage > 0) keyboard.text("⬅", `${MODEL_CALLBACK_PREFIX}${navPrefix}:${currentPage - 1}`);
    if (currentPage < totalPages - 1) keyboard.text("➡", `${MODEL_CALLBACK_PREFIX}${navPrefix}:${currentPage + 1}`);
  }
  return keyboard;
}

export function buildProviderKeyboard(models: string[], activeModel: string | null, pageSize: number, backLabel: string, page = 0): InlineKeyboard {
  const activeProvider = activeModel?.split("/", 1)[0] || null;
  const items = providersFromModels(models).map((provider) => ({
    label: provider === activeProvider ? `✅ ${compactProviderLabel(provider)}` : compactProviderLabel(provider),
    data: `${MODEL_CALLBACK_PREFIX}provider:${provider}:0`,
  }));
  const keyboard = buildPagedKeyboard(items, pageSize, page, "providers");
  if (items.length === 0) keyboard.text(backLabel, `${MODEL_CALLBACK_PREFIX}providers:0`);
  return keyboard;
}

export function buildProviderModelKeyboard(provider: string, models: string[], activeModel: string | null, pageSize: number, backLabel: string, page = 0): InlineKeyboard {
  const items = modelsForProvider(models, provider).map((model) => ({
    label: model === activeModel ? `✅ ${modelIdLabel(model)}` : modelIdLabel(model),
    data: `${MODEL_CALLBACK_PREFIX}set:${model}`,
  }));
  const keyboard = buildPagedKeyboard(items, pageSize, page, `models:${provider}`);
  if (providersFromModels(models).length > 1) {
    keyboard.row().text(backLabel, `${MODEL_CALLBACK_PREFIX}providers:0`);
  }
  return keyboard;
}

export function resolveDisplayedModel(stateModel: string | null, defaults: Record<string, string>, fallbackModel: string): string {
  if (stateModel) return stateModel;
  const first = Object.entries(defaults)[0];
  if (first) return `${first[0]}/${first[1]}`;
  return fallbackModel;
}
