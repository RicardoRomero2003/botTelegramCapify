import { getWorkerConfig } from "./worker-config.js";

type InlineKeyboardMarkup = {
  inline_keyboard: Array<Array<{ text: string; callback_data: string }>>;
};

type BotCommand = {
  command: string;
  description: string;
};

async function telegramRequest<T>(env: Env, method: string, payload: Record<string, unknown>): Promise<T> {
  const config = getWorkerConfig(env);
  const response = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(`Telegram ${method} fallo con ${response.status}`);
  }

  const json = (await response.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) {
    throw new Error(json.description ?? `Telegram ${method} devolvio ok=false.`);
  }

  return json.result as T;
}

export async function sendMessage(env: Env, chatId: number, text: string, replyMarkup?: InlineKeyboardMarkup): Promise<void> {
  await telegramRequest(env, "sendMessage", {
    chat_id: chatId,
    text,
    reply_markup: replyMarkup,
  });
}

export async function deleteMessage(env: Env, chatId: number, messageId: number): Promise<void> {
  await telegramRequest(env, "deleteMessage", {
    chat_id: chatId,
    message_id: messageId,
  });
}

export async function answerCallbackQuery(env: Env, callbackQueryId: string, text?: string): Promise<void> {
  await telegramRequest(env, "answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export async function setWebhook(env: Env, webhookUrl: string, secretToken: string): Promise<void> {
  await telegramRequest(env, "setWebhook", {
    url: webhookUrl,
    secret_token: secretToken,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: false,
  });
}

export async function getWebhookInfo(env: Env): Promise<unknown> {
  return telegramRequest(env, "getWebhookInfo", {});
}

export async function setMyCommands(env: Env, commands: BotCommand[]): Promise<void> {
  await telegramRequest(env, "setMyCommands", {
    commands,
  });
}
