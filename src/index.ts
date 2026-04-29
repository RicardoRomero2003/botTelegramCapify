import { Markup, Telegraf } from "telegraf";
import { config } from "./lib/config.js";
import { buildSignedHistoryCursor, parseSignedHistoryCursor } from "./lib/crypto.js";
import { formatExpenseHistory, formatLoggedUser, formatWelcome } from "./lib/formatters.js";
import { getExpenseHistoryPage } from "./lib/capifyApi.js";
import { clearAuthSession, clearLoginFlow, getChatState, setAuthSession, setHistoryCursor, setLoginUsuario, startLoginFlow } from "./lib/sessionStore.js";
import { signInWithSupabase } from "./lib/supabaseAuth.js";

const bot = new Telegraf(config.telegramBotToken);

function isChatAllowed(chatId: number): boolean {
  if (config.telegramAllowedChatIds.size === 0) return true;
  return config.telegramAllowedChatIds.has(chatId);
}

function ensurePrivateChat(chatId: number, chatType?: string): void {
  if (chatType && chatType !== "private") {
    throw new Error("Usa este bot solo en un chat privado de Telegram.");
  }
  if (!isChatAllowed(chatId)) {
    throw new Error("Este chat no esta autorizado para usar el bot.");
  }
}

function historyKeyboard(nextOffset: number) {
  return Markup.inlineKeyboard([
    Markup.button.callback("Mas gastos", buildSignedHistoryCursor(nextOffset)),
  ]);
}

async function sendHistoryPage(chatId: number, offset: number): Promise<{ text: string; nextOffset: number; exhausted: boolean }> {
  const state = getChatState(chatId);
  if (!state.auth) {
    throw new Error("Debes iniciar sesion primero con /login.");
  }

  const page = await getExpenseHistoryPage(state.auth, offset, 20);
  setHistoryCursor(chatId, page.nextOffset, page.exhausted);

  return {
    text: formatExpenseHistory(page, offset),
    nextOffset: page.nextOffset,
    exhausted: page.exhausted,
  };
}

bot.catch((error, ctx) => {
  console.error("Telegram bot error:", error);
  void ctx.reply(`Error: ${error instanceof Error ? error.message : "Fallo no controlado."}`);
});

bot.start(async (ctx) => {
  ensurePrivateChat(ctx.chat.id, ctx.chat.type);
  await ctx.reply(formatWelcome());
});

bot.command("login", async (ctx) => {
  ensurePrivateChat(ctx.chat.id, ctx.chat.type);
  const parts = ctx.message.text.split(/\s+/).slice(1);

  if (parts.length >= 2) {
    const usuario = parts[0] ?? "";
    const password = parts.slice(1).join(" ");
    const auth = await signInWithSupabase(usuario, password);
    setAuthSession(ctx.chat.id, auth);
    await ctx.reply(formatLoggedUser(auth.user));
    return;
  }

  startLoginFlow(ctx.chat.id);
  await ctx.reply("Introduce tu usuario de Capify.");
});

bot.command("logout", async (ctx) => {
  ensurePrivateChat(ctx.chat.id, ctx.chat.type);
  clearLoginFlow(ctx.chat.id);
  clearAuthSession(ctx.chat.id);
  await ctx.reply("Sesion cerrada.");
});

bot.command("historial", async (ctx) => {
  ensurePrivateChat(ctx.chat.id, ctx.chat.type);
  const result = await sendHistoryPage(ctx.chat.id, 0);
  await ctx.reply(result.text, result.exhausted ? undefined : historyKeyboard(result.nextOffset));
});

bot.command("mas", async (ctx) => {
  ensurePrivateChat(ctx.chat.id, ctx.chat.type);
  const state = getChatState(ctx.chat.id);
  if (!state.auth) {
    await ctx.reply("Debes iniciar sesion primero con /login.");
    return;
  }
  if (!state.history) {
    await ctx.reply("Primero usa /historial para iniciar la paginacion.");
    return;
  }
  if (state.history.exhausted) {
    await ctx.reply("No hay mas gastos para mostrar.");
    return;
  }

  const result = await sendHistoryPage(ctx.chat.id, state.history.nextOffset);
  await ctx.reply(result.text, result.exhausted ? undefined : historyKeyboard(result.nextOffset));
});

bot.on("callback_query", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  ensurePrivateChat(chatId, ctx.chat?.type);
  const callbackData = "data" in ctx.callbackQuery ? ctx.callbackQuery.data : "";
  const offset = parseSignedHistoryCursor(callbackData);

  if (offset === null) {
    await ctx.answerCbQuery("Cursor invalido.", { show_alert: false });
    return;
  }

  const result = await sendHistoryPage(chatId, offset);
  await ctx.answerCbQuery();
  await ctx.reply(result.text, result.exhausted ? undefined : historyKeyboard(result.nextOffset));
});

bot.on("text", async (ctx) => {
  const chatId = ctx.chat?.id;
  if (!chatId) return;
  ensurePrivateChat(chatId, ctx.chat?.type);
  const state = getChatState(chatId);
  if (!state.loginFlow) return;

  const text = ctx.message.text.trim();
  if (!text) {
    await ctx.reply("Texto vacio. Intentalo otra vez.");
    return;
  }

  if (state.loginFlow.step === "usuario") {
    setLoginUsuario(chatId, text);
    await ctx.reply("Introduce ahora tu contrasena.");
    return;
  }

  const usuario = state.loginFlow.usuario ?? "";
  clearLoginFlow(chatId);

  try {
    const auth = await signInWithSupabase(usuario, text);
    setAuthSession(chatId, auth);

    try {
      await ctx.deleteMessage();
    } catch {
      // Telegram may not allow deleting the user's password message in all chats/clients.
    }

    await ctx.reply(formatLoggedUser(auth.user));
  } catch (error) {
    clearAuthSession(chatId);
    await ctx.reply(`No se pudo iniciar sesion: ${error instanceof Error ? error.message : "Error desconocido."}`);
  }
});

async function main(): Promise<void> {
  await bot.telegram.setMyCommands([
    { command: "start", description: "Ver ayuda" },
    { command: "login", description: "Iniciar sesion en Capify" },
    { command: "logout", description: "Cerrar sesion actual" },
    { command: "historial", description: "Ver los ultimos 20 gastos" },
    { command: "mas", description: "Cargar los siguientes 20 gastos" },
  ]);

  await bot.launch();
  console.log("Capify Telegram bot iniciado.");
}

void main();

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => bot.stop(signal));
}
