import { formatExpenseHistory, formatLoggedUser, formatWelcome } from "./lib/formatters.js";
import type { BotChatState } from "./lib/types.js";
import { buildSignedHistoryCursor, buildWebhookSecret, parseSignedHistoryCursor } from "./worker-crypto.js";
import { getExpenseHistoryPage } from "./worker-capify-api.js";
import { getWorkerConfig } from "./worker-config.js";
import { clearAuthSession, clearLoginFlow, getChatState, setAuthSession, setHistoryCursor, setLoginUsuario, startLoginFlow } from "./worker-session-store.js";
import { signInWithSupabase } from "./worker-supabase.js";
import { answerCallbackQuery, deleteMessage, sendMessage } from "./worker-telegram.js";

type TelegramChat = {
  id: number;
  type?: string;
};

type TelegramMessage = {
  message_id: number;
  text?: string;
  chat: TelegramChat;
};

type TelegramCallbackQuery = {
  id: string;
  data?: string;
  message?: TelegramMessage;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
};

function isChatAllowed(config: ReturnType<typeof getWorkerConfig>, chatId: number): boolean {
  if (config.telegramAllowedChatIds.size === 0) return true;
  return config.telegramAllowedChatIds.has(chatId);
}

function assertPrivateChat(config: ReturnType<typeof getWorkerConfig>, chatId: number, chatType?: string): void {
  if (chatType && chatType !== "private") {
    throw new Error("Usa este bot solo en un chat privado de Telegram.");
  }
  if (!isChatAllowed(config, chatId)) {
    throw new Error("Este chat no esta autorizado para usar el bot.");
  }
}

async function historyKeyboard(secret: string, nextOffset: number) {
  return {
    inline_keyboard: [[{ text: "Mas gastos", callback_data: await buildSignedHistoryCursor(nextOffset, secret) }]],
  };
}

async function sendHistoryPage(env: Env, chatId: number, offset: number): Promise<{ text: string; nextOffset: number; exhausted: boolean }> {
  const state = await getChatState(env, chatId);
  if (!state.auth) {
    throw new Error("Debes iniciar sesion primero con /login.");
  }

  const page = await getExpenseHistoryPage(state.auth, offset, 20, env);
  await setHistoryCursor(env, chatId, page.nextOffset, page.exhausted);
  await setAuthSession(env, chatId, state.auth);

  return {
    text: formatExpenseHistory(page, offset),
    nextOffset: page.nextOffset,
    exhausted: page.exhausted,
  };
}

function normalizeCommand(text: string): { command: string; args: string[] } | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.split(/\s+/);
  const rawCommand = parts[0]?.slice(1) ?? "";
  const command = rawCommand.split("@")[0]?.toLowerCase() ?? "";
  return { command, args: parts.slice(1) };
}

async function handleLoginFlowText(env: Env, state: BotChatState, chatId: number, message: TelegramMessage): Promise<boolean> {
  if (!state.loginFlow || !message.text) return false;

  const text = message.text.trim();
  if (!text) {
    await sendMessage(env, chatId, "Texto vacio. Intentalo otra vez.");
    return true;
  }

  if (state.loginFlow.step === "usuario") {
    await setLoginUsuario(env, chatId, text);
    await sendMessage(env, chatId, "Introduce ahora tu contrasena.");
    return true;
  }

  const usuario = state.loginFlow.usuario ?? "";
  await clearLoginFlow(env, chatId);

  try {
    const auth = await signInWithSupabase(usuario, text, env);
    await setAuthSession(env, chatId, auth);

    try {
      await deleteMessage(env, chatId, message.message_id);
    } catch {
      // Telegram no siempre permite borrar el mensaje del usuario.
    }

    await sendMessage(env, chatId, formatLoggedUser(auth.user));
  } catch (error) {
    await clearAuthSession(env, chatId);
    await sendMessage(env, chatId, `No se pudo iniciar sesion: ${error instanceof Error ? error.message : "Error desconocido."}`);
  }

  return true;
}

async function handleCommand(env: Env, chatId: number, message: TelegramMessage): Promise<boolean> {
  const config = getWorkerConfig(env);
  const text = message.text?.trim();
  if (!text) return false;

  const parsed = normalizeCommand(text);
  if (!parsed) return false;

  switch (parsed.command) {
    case "start":
      await sendMessage(env, chatId, formatWelcome());
      return true;
    case "login": {
      if (parsed.args.length >= 2) {
        const usuario = parsed.args[0] ?? "";
        const password = parsed.args.slice(1).join(" ");
        const auth = await signInWithSupabase(usuario, password, env);
        await setAuthSession(env, chatId, auth);
        await sendMessage(env, chatId, formatLoggedUser(auth.user));
        return true;
      }

      await startLoginFlow(env, chatId);
      await sendMessage(env, chatId, "Introduce tu usuario de Capify.");
      return true;
    }
    case "logout":
      await clearLoginFlow(env, chatId);
      await clearAuthSession(env, chatId);
      await sendMessage(env, chatId, "Sesion cerrada.");
      return true;
    case "historial": {
      const result = await sendHistoryPage(env, chatId, 0);
      await sendMessage(env, chatId, result.text, result.exhausted ? undefined : await historyKeyboard(config.botSessionSecret, result.nextOffset));
      return true;
    }
    case "mas": {
      const state = await getChatState(env, chatId);
      if (!state.auth) {
        await sendMessage(env, chatId, "Debes iniciar sesion primero con /login.");
        return true;
      }
      if (!state.history) {
        await sendMessage(env, chatId, "Primero usa /historial para iniciar la paginacion.");
        return true;
      }
      if (state.history.exhausted) {
        await sendMessage(env, chatId, "No hay mas gastos para mostrar.");
        return true;
      }

      const result = await sendHistoryPage(env, chatId, state.history.nextOffset);
      await sendMessage(env, chatId, result.text, result.exhausted ? undefined : await historyKeyboard(config.botSessionSecret, result.nextOffset));
      return true;
    }
    default:
      return false;
  }
}

async function handleMessage(env: Env, message: TelegramMessage): Promise<void> {
  const config = getWorkerConfig(env);
  const chatId = message.chat.id;
  assertPrivateChat(config, chatId, message.chat.type);

  const state = await getChatState(env, chatId);
  const handledLogin = await handleLoginFlowText(env, state, chatId, message);
  if (handledLogin) return;

  const handledCommand = await handleCommand(env, chatId, message);
  if (handledCommand) return;
}

async function handleCallbackQuery(env: Env, callbackQuery: TelegramCallbackQuery): Promise<void> {
  const config = getWorkerConfig(env);
  const chat = callbackQuery.message?.chat;
  if (!chat) {
    await answerCallbackQuery(env, callbackQuery.id, "No se encontro el chat.");
    return;
  }

  assertPrivateChat(config, chat.id, chat.type);
  const callbackData = callbackQuery.data ?? "";
  const offset = await parseSignedHistoryCursor(callbackData, config.botSessionSecret);

  if (offset === null) {
    await answerCallbackQuery(env, callbackQuery.id, "Cursor invalido.");
    return;
  }

  const result = await sendHistoryPage(env, chat.id, offset);
  await answerCallbackQuery(env, callbackQuery.id);
  await sendMessage(env, chat.id, result.text, result.exhausted ? undefined : await historyKeyboard(config.botSessionSecret, result.nextOffset));
}

async function handleTelegramUpdate(env: Env, update: TelegramUpdate): Promise<void> {
  if (update.message?.text) {
    await handleMessage(env, update.message);
    return;
  }

  if (update.callback_query) {
    await handleCallbackQuery(env, update.callback_query);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return Response.json({ ok: true, service: "capify-telegram-bot" });
    }

    if (request.method === "POST" && url.pathname === "/telegram/webhook") {
      const config = getWorkerConfig(env);
      const expectedSecret = await buildWebhookSecret(config.botSessionSecret);
      const receivedSecret = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
      if (receivedSecret !== expectedSecret) {
        return new Response("forbidden", { status: 403 });
      }

      let update: TelegramUpdate;
      try {
        update = (await request.json()) as TelegramUpdate;
      } catch {
        return new Response("bad request", { status: 400 });
      }

      try {
        await handleTelegramUpdate(env, update);
      } catch (error) {
        console.error("Telegram worker error", error);
        const chatId = update.message?.chat.id ?? update.callback_query?.message?.chat.id;
        if (chatId) {
          try {
            await sendMessage(env, chatId, `Error: ${error instanceof Error ? error.message : "Fallo no controlado."}`);
          } catch {
            // no-op
          }
        }
      }

      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  },
};
