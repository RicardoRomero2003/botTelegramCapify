import type { BotAuthSession, BotChatState, ExpenseFlowState } from "./lib/types.js";

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

function createDefaultState(): BotChatState {
  return {
    auth: null,
    loginFlow: null,
    expenseFlow: null,
    history: null,
  };
}

function sessionKey(chatId: number): string {
  return `chat:${chatId}`;
}

export async function getChatState(env: Env, chatId: number): Promise<BotChatState> {
  const stored = await env.CAPIFY_BOT_SESSIONS.get(sessionKey(chatId), "json");
  if (stored && typeof stored === "object") {
    return stored as BotChatState;
  }
  return createDefaultState();
}

export async function saveChatState(env: Env, chatId: number, state: BotChatState): Promise<void> {
  await env.CAPIFY_BOT_SESSIONS.put(sessionKey(chatId), JSON.stringify(state), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
}

export async function setAuthSession(env: Env, chatId: number, auth: BotAuthSession): Promise<void> {
  const state = await getChatState(env, chatId);
  state.auth = auth;
  state.loginFlow = null;
  state.expenseFlow = null;
  state.history = null;
  await saveChatState(env, chatId, state);
}

export async function clearAuthSession(env: Env, chatId: number): Promise<void> {
  const state = await getChatState(env, chatId);
  state.auth = null;
  state.history = null;
  await saveChatState(env, chatId, state);
}

export async function startLoginFlow(env: Env, chatId: number): Promise<void> {
  const state = await getChatState(env, chatId);
  state.loginFlow = { step: "usuario" };
  state.expenseFlow = null;
  await saveChatState(env, chatId, state);
}

export async function setLoginUsuario(env: Env, chatId: number, usuario: string): Promise<void> {
  const state = await getChatState(env, chatId);
  state.loginFlow = { step: "password", usuario };
  await saveChatState(env, chatId, state);
}

export async function clearLoginFlow(env: Env, chatId: number): Promise<void> {
  const state = await getChatState(env, chatId);
  state.loginFlow = null;
  await saveChatState(env, chatId, state);
}

export async function setExpenseFlow(env: Env, chatId: number, expenseFlow: ExpenseFlowState): Promise<void> {
  const state = await getChatState(env, chatId);
  state.expenseFlow = expenseFlow;
  state.loginFlow = null;
  await saveChatState(env, chatId, state);
}

export async function clearExpenseFlow(env: Env, chatId: number): Promise<void> {
  const state = await getChatState(env, chatId);
  state.expenseFlow = null;
  await saveChatState(env, chatId, state);
}

export async function setHistoryCursor(env: Env, chatId: number, nextOffset: number, exhausted: boolean): Promise<void> {
  const state = await getChatState(env, chatId);
  state.history = { nextOffset, exhausted };
  await saveChatState(env, chatId, state);
}
