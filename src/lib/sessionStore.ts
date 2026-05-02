import type { BotChatState, BotAuthSession } from "./types.js";

const chatStates = new Map<number, BotChatState>();

function createDefaultState(): BotChatState {
  return {
    auth: null,
    loginFlow: null,
    expenseFlow: null,
    history: null,
  };
}

export function getChatState(chatId: number): BotChatState {
  const existing = chatStates.get(chatId);
  if (existing) return existing;
  const created = createDefaultState();
  chatStates.set(chatId, created);
  return created;
}

export function setAuthSession(chatId: number, auth: BotAuthSession): void {
  const state = getChatState(chatId);
  state.auth = auth;
  state.loginFlow = null;
  state.expenseFlow = null;
  state.history = null;
}

export function clearAuthSession(chatId: number): void {
  const state = getChatState(chatId);
  state.auth = null;
  state.history = null;
}

export function startLoginFlow(chatId: number): void {
  const state = getChatState(chatId);
  state.loginFlow = { step: "usuario" };
  state.expenseFlow = null;
}

export function setLoginUsuario(chatId: number, usuario: string): void {
  const state = getChatState(chatId);
  state.loginFlow = { step: "password", usuario };
}

export function clearLoginFlow(chatId: number): void {
  const state = getChatState(chatId);
  state.loginFlow = null;
}

export function setHistoryCursor(chatId: number, nextOffset: number, exhausted: boolean): void {
  const state = getChatState(chatId);
  state.history = { nextOffset, exhausted };
}
