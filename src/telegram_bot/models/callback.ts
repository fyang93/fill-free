import type { Context } from "grammy";
import type { AppConfig } from "../app/types";
import { state } from "../app/state";
import { t } from "../app/i18n";
import {
  buildProviderKeyboard,
  buildProviderModelKeyboard,
  compactModelLabel,
  MODEL_CALLBACK_PREFIX,
  modelsForProvider,
  providersFromModels,
  resolveDisplayedModel,
} from "./menu";

export type ModelCallbackDependencies = {
  config: AppConfig;
  listModels: () => Promise<{ defaults: Record<string, string>; models: string[] }>;
  currentModelLabel: () => string;
  persistState: () => Promise<void>;
  interruptActiveTask: (reason: string) => Promise<void>;
  editMessageTextFormattedSafe: (ctx: Context, chatId: number, messageId: number, text: string, options?: { reply_markup?: unknown }) => Promise<void>;
};

export async function handleModelCallback(ctx: Context, deps: ModelCallbackDependencies): Promise<boolean> {
  const data = ctx.callbackQuery?.data || "";
  if (!data.startsWith(MODEL_CALLBACK_PREFIX)) return false;

  const { config } = deps;
  const rest = data.slice(MODEL_CALLBACK_PREFIX.length);
  const backLabel = t(config, "reminder_back");

  try {
    const { defaults, models } = await deps.listModels();
    const activeModel = state.model || resolveDisplayedModel(state.model, defaults, deps.currentModelLabel());

    if (rest.startsWith("providers:")) {
      const providers = providersFromModels(models);
      if (providers.length === 1) {
        const provider = providers[0];
        if (ctx.chat && ctx.callbackQuery?.message?.message_id) {
          await deps.editMessageTextFormattedSafe(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id, t(config, "choose_model_under_provider", { provider }), {
            reply_markup: buildProviderModelKeyboard(provider, models, activeModel, config.bot.menuPageSize, backLabel, 0),
          });
        }
        await ctx.answerCallbackQuery();
        return true;
      }
      const page = Number(rest.split(":", 2)[1] || 0);
      if (ctx.chat && ctx.callbackQuery?.message?.message_id) {
        await deps.editMessageTextFormattedSafe(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id, t(config, "choose_provider"), {
          reply_markup: buildProviderKeyboard(models, activeModel, config.bot.menuPageSize, backLabel, page),
        });
      }
      await ctx.answerCallbackQuery();
      return true;
    }

    if (rest.startsWith("provider:")) {
      const [, provider, pageRaw] = rest.split(":", 3);
      const providerModels = modelsForProvider(models, provider || "");
      if (providerModels.length === 0) {
        await ctx.answerCallbackQuery({ text: t(config, "model_unavailable"), show_alert: true });
        return true;
      }
      if (ctx.chat && ctx.callbackQuery?.message?.message_id) {
        await deps.editMessageTextFormattedSafe(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id, t(config, "choose_model_under_provider", { provider }), {
          reply_markup: buildProviderModelKeyboard(provider, models, activeModel, config.bot.menuPageSize, backLabel, Number(pageRaw || 0)),
        });
      }
      await ctx.answerCallbackQuery();
      return true;
    }

    if (rest.startsWith("models:")) {
      const [, provider, pageRaw] = rest.split(":", 3);
      if (ctx.chat && ctx.callbackQuery?.message?.message_id) {
        await deps.editMessageTextFormattedSafe(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id, t(config, "choose_model_under_provider", { provider }), {
          reply_markup: buildProviderModelKeyboard(provider || "", models, activeModel, config.bot.menuPageSize, backLabel, Number(pageRaw || 0)),
        });
      }
      await ctx.answerCallbackQuery();
      return true;
    }

    if (!rest.startsWith("set:")) {
      await ctx.answerCallbackQuery();
      return true;
    }

    const model = rest.slice(4);
    if (!models.includes(model)) {
      await ctx.answerCallbackQuery({ text: t(config, "model_unavailable"), show_alert: true });
      return true;
    }

    await deps.interruptActiveTask(`model callback switch to ${model}`);
    state.model = model;
    await deps.persistState();
    await ctx.answerCallbackQuery({ text: t(config, "callback_model_switched", { model: compactModelLabel(model) }) });

    if (ctx.chat && ctx.callbackQuery?.message?.message_id) {
      const provider = model.split("/", 1)[0];
      await deps.editMessageTextFormattedSafe(ctx, ctx.chat.id, ctx.callbackQuery.message.message_id, t(config, "choose_model_under_provider", { provider }), {
        reply_markup: buildProviderModelKeyboard(provider, models, state.model || model, config.bot.menuPageSize, backLabel, 0),
      });
    }
    return true;
  } catch (error) {
    await ctx.answerCallbackQuery({ text: error instanceof Error ? error.message : String(error), show_alert: true });
    return true;
  }
}
