import { formatExpenseHistory, formatLoggedUser, formatWelcome } from "./lib/formatters.js";
import type {
  BotChatState,
  ExpenseCategory,
  ExpenseDraft,
  ExpenseFlowState,
  ExpenseKind,
  ExpensePaymentMethod,
  ExpenseTransportType,
  IncomeDraft,
  IncomeFlowState,
  IncomeMethod,
  IncomeTarget,
} from "./lib/types.js";
import { buildSignedHistoryCursor, buildWebhookSecret, parseSignedHistoryCursor } from "./worker-crypto.js";
import { createFinancialExpense, createFinancialIncome, getExpenseHistoryPage } from "./worker-capify-api.js";
import { getWorkerConfig } from "./worker-config.js";
import {
  clearAuthSession,
  clearExpenseFlow,
  clearIncomeFlow,
  clearLoginFlow,
  getChatState,
  setAuthSession,
  setExpenseFlow,
  setHistoryCursor,
  setIncomeFlow,
  setLoginUsuario,
  startLoginFlow,
} from "./worker-session-store.js";
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

const EXPENSE_CALLBACK_PREFIX = "expense";
const INCOME_CALLBACK_PREFIX = "income";
const APP_CALLBACK_PREFIX = "app";
const EXPENSE_CATEGORIES: ExpenseCategory[] = ["DEPORTE", "TRANSPORTE", "OCIO", "COMIDA", "OTROS"];
const TRANSPORT_TYPES: ExpenseTransportType[] = ["Transporte Publico", "Uber", "Gasolina"];
const EXPENSE_KINDS: ExpenseKind[] = ["MENSUALIDAD", "PUNTUAL"];
const PAYMENT_METHODS: ExpensePaymentMethod[] = ["Cuenta de gastos", "Tarjeta de Ineco"];
const INCOME_TARGETS: IncomeTarget[] = ["Capital ahorrado", "Capital a invertir", "Capital disponible para gastos", "Tarjeta de Ineco"];
const INCOME_METHODS: IncomeMethod[] = ["Bizum", "Transferencia"];

const TRANSPORT_CALLBACK_VALUES: Record<string, ExpenseTransportType> = {
  TRANSPORTE_PUBLICO: "Transporte Publico",
  UBER: "Uber",
  GASOLINA: "Gasolina",
};

const PAYMENT_CALLBACK_VALUES: Record<string, ExpensePaymentMethod> = {
  CUENTA_GASTOS: "Cuenta de gastos",
  TARJETA_INECO: "Tarjeta de Ineco",
};

const INCOME_TARGET_CALLBACK_VALUES: Record<string, IncomeTarget> = {
  CAPITAL_AHORRADO: "Capital ahorrado",
  CAPITAL_INVERTIR: "Capital a invertir",
  CAPITAL_GASTOS: "Capital disponible para gastos",
  TARJETA_INECO: "Tarjeta de Ineco",
};

const INCOME_METHOD_CALLBACK_VALUES: Record<string, IncomeMethod> = {
  BIZUM: "Bizum",
  TRANSFERENCIA: "Transferencia",
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

function buildExpenseCallback(action: string, value?: string): string {
  return value ? `${EXPENSE_CALLBACK_PREFIX}:${action}:${value}` : `${EXPENSE_CALLBACK_PREFIX}:${action}`;
}

function parseExpenseCallback(value: string): { action: string; value: string | null } | null {
  const parts = value.split(":");
  if (parts[0] !== EXPENSE_CALLBACK_PREFIX || parts.length < 2) return null;
  return {
    action: parts[1] ?? "",
    value: parts.slice(2).join(":") || null,
  };
}

function buildIncomeCallback(action: string, value?: string): string {
  return value ? `${INCOME_CALLBACK_PREFIX}:${action}:${value}` : `${INCOME_CALLBACK_PREFIX}:${action}`;
}

function parseIncomeCallback(value: string): { action: string; value: string | null } | null {
  const parts = value.split(":");
  if (parts[0] !== INCOME_CALLBACK_PREFIX || parts.length < 2) return null;
  return {
    action: parts[1] ?? "",
    value: parts.slice(2).join(":") || null,
  };
}

function buildAppCallback(platform: "android" | "ios"): string {
  return `${APP_CALLBACK_PREFIX}:${platform}`;
}

function parseAppCallback(value: string): "android" | "ios" | null {
  if (value === `${APP_CALLBACK_PREFIX}:android`) return "android";
  if (value === `${APP_CALLBACK_PREFIX}:ios`) return "ios";
  return null;
}

function categoryKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "DEPORTE", callback_data: buildExpenseCallback("category", "DEPORTE") }],
      [{ text: "TRANSPORTE", callback_data: buildExpenseCallback("category", "TRANSPORTE") }],
      [{ text: "OCIO", callback_data: buildExpenseCallback("category", "OCIO") }],
      [{ text: "COMIDA", callback_data: buildExpenseCallback("category", "COMIDA") }],
      [{ text: "OTROS", callback_data: buildExpenseCallback("category", "OTROS") }],
      [{ text: "Cancelar", callback_data: buildExpenseCallback("cancel") }],
    ],
  };
}

function transportKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Transporte Publico", callback_data: buildExpenseCallback("transport", "TRANSPORTE_PUBLICO") }],
      [{ text: "Uber", callback_data: buildExpenseCallback("transport", "UBER") }],
      [{ text: "Gasolina", callback_data: buildExpenseCallback("transport", "GASOLINA") }],
      [{ text: "Cancelar", callback_data: buildExpenseCallback("cancel") }],
    ],
  };
}

function kindKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Mensualidad", callback_data: buildExpenseCallback("kind", "MENSUALIDAD") }],
      [{ text: "Puntual", callback_data: buildExpenseCallback("kind", "PUNTUAL") }],
      [{ text: "Cancelar", callback_data: buildExpenseCallback("cancel") }],
    ],
  };
}

function paymentKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Cuenta de gastos", callback_data: buildExpenseCallback("payment", "CUENTA_GASTOS") }],
      [{ text: "Tarjeta de Ineco", callback_data: buildExpenseCallback("payment", "TARJETA_INECO") }],
      [{ text: "Cancelar", callback_data: buildExpenseCallback("cancel") }],
    ],
  };
}

function confirmKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Confirmar", callback_data: buildExpenseCallback("confirm") }],
      [{ text: "Cancelar", callback_data: buildExpenseCallback("cancel") }],
    ],
  };
}

function appKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Android", callback_data: buildAppCallback("android") }],
      [{ text: "iPhone", callback_data: buildAppCallback("ios") }],
    ],
  };
}

function incomeTargetKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Capital ahorrado", callback_data: buildIncomeCallback("target", "CAPITAL_AHORRADO") }],
      [{ text: "Capital a invertir", callback_data: buildIncomeCallback("target", "CAPITAL_INVERTIR") }],
      [{ text: "Capital disponible para gastos", callback_data: buildIncomeCallback("target", "CAPITAL_GASTOS") }],
      [{ text: "Tarjeta de Ineco", callback_data: buildIncomeCallback("target", "TARJETA_INECO") }],
      [{ text: "Cancelar", callback_data: buildIncomeCallback("cancel") }],
    ],
  };
}

function incomeMethodKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Bizum", callback_data: buildIncomeCallback("method", "BIZUM") }],
      [{ text: "Transferencia", callback_data: buildIncomeCallback("method", "TRANSFERENCIA") }],
      [{ text: "Cancelar", callback_data: buildIncomeCallback("cancel") }],
    ],
  };
}

function incomeConfirmKeyboard() {
  return {
    inline_keyboard: [
      [{ text: "Confirmar", callback_data: buildIncomeCallback("confirm") }],
      [{ text: "Cancelar", callback_data: buildIncomeCallback("cancel") }],
    ],
  };
}

async function historyKeyboard(secret: string, nextOffset: number, shownCount: number) {
  return {
    inline_keyboard: [[{ text: "Mas transacciones", callback_data: await buildSignedHistoryCursor(nextOffset, shownCount, secret) }]],
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

function formatAmount(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function parsePrice(raw: string): number | null {
  const normalized = Number(raw.replace(",", "."));
  if (!Number.isFinite(normalized) || normalized <= 0) return null;
  return normalized;
}

function parseDateToApiDate(raw: string): string | null {
  const normalized = raw.trim();
  if (!normalized) return null;

  const slashPattern = /^(\d{2})\/(\d{2})\/(\d{4})$/;
  const isoPattern = /^(\d{4})-(\d{2})-(\d{2})$/;

  if (slashPattern.test(normalized)) {
    const [, day, month, year] = normalized.match(slashPattern) ?? [];
    if (!isValidDateParts(Number(year), Number(month), Number(day))) return null;
    return `${year}-${month}-${day}`;
  }

  if (isoPattern.test(normalized)) {
    const [, year, month, day] = normalized.match(isoPattern) ?? [];
    if (!isValidDateParts(Number(year), Number(month), Number(day))) return null;
    return `${year}-${month}-${day}`;
  }

  return null;
}

function isValidDateParts(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 3000) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function getNextStepAfterCategory(category: ExpenseCategory): ExpenseFlowState["step"] {
  return category === "TRANSPORTE" ? "transport_type" : "name";
}

function getNextStepAfterName(category: ExpenseCategory): ExpenseFlowState["step"] {
  return category === "OCIO" ? "location" : "price";
}

function buildExpenseSummary(draft: ExpenseDraft): string {
  const lines = ["Resumen del gasto:", ""];
  lines.push(`Categoria: ${draft.categoria ?? "-"}`);
  if (draft.nombre) lines.push(`Nombre: ${draft.nombre}`);
  if (draft.tipo_transporte) lines.push(`Tipo de transporte: ${draft.tipo_transporte}`);
  if (draft.ubicacion) lines.push(`Ubicacion: ${draft.ubicacion}`);
  if (typeof draft.precio === "number") lines.push(`Precio: ${formatAmount(draft.precio)}`);
  if (draft.fecha) lines.push(`Fecha: ${draft.fecha}`);
  if (draft.tipo) lines.push(`Tipo: ${draft.tipo}`);
  if (draft.forma_pago) lines.push(`Forma de pago: ${draft.forma_pago}`);
  lines.push("", "Confirma para guardar el gasto o cancela para descartarlo.");
  return lines.join("\n");
}

function buildIncomeSummary(draft: IncomeDraft): string {
  const lines = ["Resumen del ingreso:", ""];
  lines.push(`Ingresar en: ${draft.ingresar_en ?? "-"}`);
  if (typeof draft.monto === "number") lines.push(`Monto: ${formatAmount(draft.monto)}`);
  if (draft.descripcion) lines.push(`Descripcion: ${draft.descripcion}`);
  if (draft.metodo) lines.push(`Metodo: ${draft.metodo}`);
  if (draft.nombre_remitente) lines.push(`Nombre del remitente: ${draft.nombre_remitente}`);
  lines.push("", "Confirma para guardar el ingreso o cancela para descartarlo.");
  return lines.join("\n");
}

async function sendExpenseStepPrompt(env: Env, chatId: number, flow: ExpenseFlowState): Promise<void> {
  switch (flow.step) {
    case "category":
      await sendMessage(env, chatId, "Selecciona la categoria del gasto.", categoryKeyboard());
      return;
    case "name":
      await sendMessage(env, chatId, "Introduce el nombre del gasto.");
      return;
    case "transport_type":
      await sendMessage(env, chatId, "Selecciona el tipo de transporte.", transportKeyboard());
      return;
    case "location":
      await sendMessage(env, chatId, "Introduce la ubicacion del gasto de ocio.");
      return;
    case "price":
      await sendMessage(env, chatId, "Introduce el precio del gasto. Ejemplo: 12,50");
      return;
    case "date":
      await sendMessage(env, chatId, "Introduce la fecha del gasto en formato DD/MM/AAAA o YYYY-MM-DD.");
      return;
    case "kind":
      await sendMessage(env, chatId, "Selecciona el tipo de gasto.", kindKeyboard());
      return;
    case "payment_method":
      await sendMessage(env, chatId, "Selecciona la forma de pago.", paymentKeyboard());
      return;
    case "confirm":
      await sendMessage(env, chatId, buildExpenseSummary(flow.draft), confirmKeyboard());
      return;
  }
}

async function sendIncomeStepPrompt(env: Env, chatId: number, flow: IncomeFlowState): Promise<void> {
  switch (flow.step) {
    case "target":
      await sendMessage(env, chatId, "Selecciona donde quieres ingresar el dinero.", incomeTargetKeyboard());
      return;
    case "amount":
      await sendMessage(env, chatId, "Introduce el monto del ingreso. Ejemplo: 25,50");
      return;
    case "description":
      await sendMessage(env, chatId, "Introduce la descripcion del ingreso.");
      return;
    case "method":
      await sendMessage(env, chatId, "Selecciona el metodo del ingreso.", incomeMethodKeyboard());
      return;
    case "sender":
      await sendMessage(env, chatId, "Introduce el nombre del remitente.");
      return;
    case "confirm":
      await sendMessage(env, chatId, buildIncomeSummary(flow.draft), incomeConfirmKeyboard());
      return;
  }
}

async function transitionExpenseFlow(env: Env, chatId: number, flow: ExpenseFlowState): Promise<void> {
  await setExpenseFlow(env, chatId, flow);
  await sendExpenseStepPrompt(env, chatId, flow);
}

async function transitionIncomeFlow(env: Env, chatId: number, flow: IncomeFlowState): Promise<void> {
  await setIncomeFlow(env, chatId, flow);
  await sendIncomeStepPrompt(env, chatId, flow);
}

async function sendHistoryPage(
  env: Env,
  chatId: number,
  offset: number,
  shownCount: number,
): Promise<{ text: string; nextOffset: number; shownCount: number; exhausted: boolean }> {
  const state = await getChatState(env, chatId);
  if (!state.auth) {
    throw new Error("Debes iniciar sesion primero con /login.");
  }

  const page = await getExpenseHistoryPage(state.auth, offset, 20, env);
  await setAuthSession(env, chatId, state.auth);
  const nextShownCount = shownCount + page.consumedCount;
  await setHistoryCursor(env, chatId, page.nextOffset, nextShownCount, page.exhausted);

  return {
    text: formatExpenseHistory(page, shownCount),
    nextOffset: page.nextOffset,
    shownCount: nextShownCount,
    exhausted: page.exhausted,
  };
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

async function handleExpenseFlowText(env: Env, state: BotChatState, chatId: number, message: TelegramMessage): Promise<boolean> {
  const flow = state.expenseFlow;
  if (!flow || !message.text) return false;

  const text = message.text.trim();
  if (!text) {
    await sendMessage(env, chatId, "Texto vacio. Intentalo otra vez.");
    return true;
  }

  switch (flow.step) {
    case "name": {
      await transitionExpenseFlow(env, chatId, {
        step: getNextStepAfterName(flow.draft.categoria as ExpenseCategory),
        draft: { ...flow.draft, nombre: text },
      });
      return true;
    }
    case "location": {
      await transitionExpenseFlow(env, chatId, {
        step: "price",
        draft: { ...flow.draft, ubicacion: text },
      });
      return true;
    }
    case "price": {
      const price = parsePrice(text);
      if (price === null) {
        await sendMessage(env, chatId, "Introduce un precio valido mayor que 0.");
        return true;
      }
      await transitionExpenseFlow(env, chatId, {
        step: "date",
        draft: { ...flow.draft, precio: price },
      });
      return true;
    }
    case "date": {
      const apiDate = parseDateToApiDate(text);
      if (!apiDate) {
        await sendMessage(env, chatId, "Fecha invalida. Usa formato DD/MM/AAAA o YYYY-MM-DD.");
        return true;
      }
      const category = flow.draft.categoria as ExpenseCategory;
      if (category === "OTROS" || category === "COMIDA") {
        await transitionExpenseFlow(env, chatId, {
          step: "payment_method",
          draft: { ...flow.draft, fecha: apiDate, tipo: "PUNTUAL" },
        });
        return true;
      }
      await transitionExpenseFlow(env, chatId, {
        step: "kind",
        draft: { ...flow.draft, fecha: apiDate },
      });
      return true;
    }
    default:
      return false;
  }
}

async function handleIncomeFlowText(env: Env, state: BotChatState, chatId: number, message: TelegramMessage): Promise<boolean> {
  const flow = state.incomeFlow;
  if (!flow || !message.text) return false;

  const text = message.text.trim();
  if (!text) {
    await sendMessage(env, chatId, "Texto vacio. Intentalo otra vez.");
    return true;
  }

  switch (flow.step) {
    case "amount": {
      const amount = parsePrice(text);
      if (amount === null) {
        await sendMessage(env, chatId, "Introduce un monto valido mayor que 0.");
        return true;
      }
      await transitionIncomeFlow(env, chatId, {
        step: "description",
        draft: { ...flow.draft, monto: amount },
      });
      return true;
    }
    case "description": {
      await transitionIncomeFlow(env, chatId, {
        step: "method",
        draft: { ...flow.draft, descripcion: text },
      });
      return true;
    }
    case "sender": {
      await transitionIncomeFlow(env, chatId, {
        step: "confirm",
        draft: { ...flow.draft, nombre_remitente: text },
      });
      return true;
    }
    default:
      return false;
  }
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
      await clearExpenseFlow(env, chatId);
      await clearIncomeFlow(env, chatId);
      await clearAuthSession(env, chatId);
      await sendMessage(env, chatId, "Sesion cerrada.");
      return true;
    case "historial": {
      const result = await sendHistoryPage(env, chatId, 0, 0);
      await sendMessage(
        env,
        chatId,
        result.text,
        result.exhausted ? undefined : await historyKeyboard(config.botSessionSecret, result.nextOffset, result.shownCount),
      );
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
        await sendMessage(env, chatId, "No hay mas transacciones para mostrar.");
        return true;
      }

      const result = await sendHistoryPage(env, chatId, state.history.nextOffset, state.history.shownCount);
      await sendMessage(
        env,
        chatId,
        result.text,
        result.exhausted ? undefined : await historyKeyboard(config.botSessionSecret, result.nextOffset, result.shownCount),
      );
      return true;
    }
    case "gasto": {
      const state = await getChatState(env, chatId);
      if (!state.auth) {
        await sendMessage(env, chatId, "Debes iniciar sesion primero con /login.");
        return true;
      }
      await transitionExpenseFlow(env, chatId, { step: "category", draft: {} });
      return true;
    }
    case "ingreso": {
      const state = await getChatState(env, chatId);
      if (!state.auth) {
        await sendMessage(env, chatId, "Debes iniciar sesion primero con /login.");
        return true;
      }
      await transitionIncomeFlow(env, chatId, { step: "target", draft: {} });
      return true;
    }
    case "app":
      await sendMessage(env, chatId, "Selecciona la plataforma para la instalacion de Capify.", appKeyboard());
      return true;
    default:
      return false;
  }
}

async function handleMessage(env: Env, message: TelegramMessage): Promise<void> {
  const config = getWorkerConfig(env);
  const chatId = message.chat.id;
  assertPrivateChat(config, chatId, message.chat.type);

  const handledCommand = await handleCommand(env, chatId, message);
  if (handledCommand) return;

  const state = await getChatState(env, chatId);
  const handledLogin = await handleLoginFlowText(env, state, chatId, message);
  if (handledLogin) return;

  const handledExpenseFlow = await handleExpenseFlowText(env, state, chatId, message);
  if (handledExpenseFlow) return;

  const handledIncomeFlow = await handleIncomeFlowText(env, state, chatId, message);
  if (handledIncomeFlow) return;
}

async function handleExpenseCallback(env: Env, chatId: number, callbackQueryId: string, callbackData: string): Promise<boolean> {
  const parsed = parseExpenseCallback(callbackData);
  if (!parsed) return false;

  const state = await getChatState(env, chatId);

  if (parsed.action === "cancel") {
    await clearExpenseFlow(env, chatId);
    await answerCallbackQuery(env, callbackQueryId, "Operacion cancelada.");
    await sendMessage(env, chatId, "Creacion de gasto cancelada.");
    return true;
  }

  if (!state.auth) {
    await answerCallbackQuery(env, callbackQueryId, "Debes iniciar sesion primero.");
    return true;
  }

  const flow = state.expenseFlow;
  if (!flow) {
    await answerCallbackQuery(env, callbackQueryId, "No hay ningun gasto en curso. Usa /gasto.");
    return true;
  }

  switch (parsed.action) {
    case "category": {
      const category = parsed.value as ExpenseCategory | null;
      if (!category || !EXPENSE_CATEGORIES.includes(category)) {
        await answerCallbackQuery(env, callbackQueryId, "Categoria invalida.");
        return true;
      }
      await answerCallbackQuery(env, callbackQueryId);
      await transitionExpenseFlow(env, chatId, {
        step: getNextStepAfterCategory(category),
        draft: {
          categoria: category,
          tipo: category === "OTROS" || category === "COMIDA" ? "PUNTUAL" : undefined,
        },
      });
      return true;
    }
    case "transport": {
      if (flow.step !== "transport_type") {
        await answerCallbackQuery(env, callbackQueryId, "Paso invalido.");
        return true;
      }
      const transport = parsed.value ? TRANSPORT_CALLBACK_VALUES[parsed.value] : undefined;
      if (!transport) {
        await answerCallbackQuery(env, callbackQueryId, "Tipo de transporte invalido.");
        return true;
      }
      await answerCallbackQuery(env, callbackQueryId);
      await transitionExpenseFlow(env, chatId, {
        step: "price",
        draft: { ...flow.draft, tipo_transporte: transport },
      });
      return true;
    }
    case "kind": {
      if (flow.step !== "kind") {
        await answerCallbackQuery(env, callbackQueryId, "Paso invalido.");
        return true;
      }
      const kind = parsed.value as ExpenseKind | null;
      if (!kind || !EXPENSE_KINDS.includes(kind)) {
        await answerCallbackQuery(env, callbackQueryId, "Tipo de gasto invalido.");
        return true;
      }
      await answerCallbackQuery(env, callbackQueryId);
      await transitionExpenseFlow(env, chatId, {
        step: "payment_method",
        draft: { ...flow.draft, tipo: kind },
      });
      return true;
    }
    case "payment": {
      if (flow.step !== "payment_method") {
        await answerCallbackQuery(env, callbackQueryId, "Paso invalido.");
        return true;
      }
      const payment = parsed.value ? PAYMENT_CALLBACK_VALUES[parsed.value] : undefined;
      if (!payment || !PAYMENT_METHODS.includes(payment)) {
        await answerCallbackQuery(env, callbackQueryId, "Forma de pago invalida.");
        return true;
      }
      await answerCallbackQuery(env, callbackQueryId);
      await transitionExpenseFlow(env, chatId, {
        step: "confirm",
        draft: { ...flow.draft, forma_pago: payment },
      });
      return true;
    }
    case "confirm": {
      if (flow.step !== "confirm") {
        await answerCallbackQuery(env, callbackQueryId, "Paso invalido.");
        return true;
      }
      const draft = flow.draft;
      if (!draft.categoria || !draft.precio || !draft.fecha || !draft.tipo || !draft.forma_pago) {
        await answerCallbackQuery(env, callbackQueryId, "Faltan datos del gasto.");
        return true;
      }

      await answerCallbackQuery(env, callbackQueryId);
      try {
        const response = await createFinancialExpense(
          state.auth,
          {
            categoria: draft.categoria,
            nombre: draft.nombre,
            precio: draft.precio,
            fecha: draft.fecha,
            tipo: draft.tipo,
            forma_pago: draft.forma_pago,
            tipo_transporte: draft.tipo_transporte,
            ubicacion: draft.ubicacion,
          },
          env,
        );
        await setAuthSession(env, chatId, state.auth);
        await clearExpenseFlow(env, chatId);
        await sendMessage(
          env,
          chatId,
          `${response.message}\n\n${buildExpenseSummary(draft)}\n\nID transaccion: ${response.transaction.id}`,
        );
      } catch (error) {
        await setExpenseFlow(env, chatId, flow);
        await sendMessage(env, chatId, `No se pudo guardar el gasto: ${error instanceof Error ? error.message : "Error desconocido."}`);
      }
      return true;
    }
    default:
      await answerCallbackQuery(env, callbackQueryId, "Accion invalida.");
      return true;
  }
}

async function handleIncomeCallback(env: Env, chatId: number, callbackQueryId: string, callbackData: string): Promise<boolean> {
  const parsed = parseIncomeCallback(callbackData);
  if (!parsed) return false;

  const state = await getChatState(env, chatId);

  if (parsed.action === "cancel") {
    await clearIncomeFlow(env, chatId);
    await answerCallbackQuery(env, callbackQueryId, "Operacion cancelada.");
    await sendMessage(env, chatId, "Creacion de ingreso cancelada.");
    return true;
  }

  if (!state.auth) {
    await answerCallbackQuery(env, callbackQueryId, "Debes iniciar sesion primero.");
    return true;
  }

  const flow = state.incomeFlow;
  if (!flow) {
    await answerCallbackQuery(env, callbackQueryId, "No hay ningun ingreso en curso. Usa /ingreso.");
    return true;
  }

  switch (parsed.action) {
    case "target": {
      if (flow.step !== "target") {
        await answerCallbackQuery(env, callbackQueryId, "Paso invalido.");
        return true;
      }
      const target = parsed.value ? INCOME_TARGET_CALLBACK_VALUES[parsed.value] : undefined;
      if (!target || !INCOME_TARGETS.includes(target)) {
        await answerCallbackQuery(env, callbackQueryId, "Destino de ingreso invalido.");
        return true;
      }
      await answerCallbackQuery(env, callbackQueryId);
      await transitionIncomeFlow(env, chatId, {
        step: "amount",
        draft: { ...flow.draft, ingresar_en: target },
      });
      return true;
    }
    case "method": {
      if (flow.step !== "method") {
        await answerCallbackQuery(env, callbackQueryId, "Paso invalido.");
        return true;
      }
      const method = parsed.value ? INCOME_METHOD_CALLBACK_VALUES[parsed.value] : undefined;
      if (!method || !INCOME_METHODS.includes(method)) {
        await answerCallbackQuery(env, callbackQueryId, "Metodo de ingreso invalido.");
        return true;
      }
      await answerCallbackQuery(env, callbackQueryId);
      await transitionIncomeFlow(env, chatId, {
        step: "sender",
        draft: { ...flow.draft, metodo: method },
      });
      return true;
    }
    case "confirm": {
      if (flow.step !== "confirm") {
        await answerCallbackQuery(env, callbackQueryId, "Paso invalido.");
        return true;
      }
      const draft = flow.draft;
      if (!draft.ingresar_en || !draft.monto || !draft.descripcion || !draft.metodo || !draft.nombre_remitente) {
        await answerCallbackQuery(env, callbackQueryId, "Faltan datos del ingreso.");
        return true;
      }

      await answerCallbackQuery(env, callbackQueryId);
      try {
        const response = await createFinancialIncome(
          state.auth,
          {
            ingresar_en: draft.ingresar_en,
            monto: draft.monto,
            descripcion: draft.descripcion,
            metodo: draft.metodo,
            nombre_remitente: draft.nombre_remitente,
          },
          env,
        );
        await setAuthSession(env, chatId, state.auth);
        await clearIncomeFlow(env, chatId);
        await sendMessage(
          env,
          chatId,
          `${response.message}\n\n${buildIncomeSummary(draft)}\n\nID transaccion: ${response.transaction.id}`,
        );
      } catch (error) {
        await setIncomeFlow(env, chatId, flow);
        await sendMessage(env, chatId, `No se pudo guardar el ingreso: ${error instanceof Error ? error.message : "Error desconocido."}`);
      }
      return true;
    }
    default:
      await answerCallbackQuery(env, callbackQueryId, "Accion invalida.");
      return true;
  }
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

  const handledExpense = await handleExpenseCallback(env, chat.id, callbackQuery.id, callbackData);
  if (handledExpense) return;

  const handledIncome = await handleIncomeCallback(env, chat.id, callbackQuery.id, callbackData);
  if (handledIncome) return;

  const appPlatform = parseAppCallback(callbackData);
  if (appPlatform) {
    await answerCallbackQuery(env, callbackQuery.id);
    if (appPlatform === "android") {
      await sendMessage(
        env,
        chat.id,
        "Android seleccionado. Todavia no hay un APK publicado desde el bot. El siguiente paso sera generar y alojar el build para poder descargarlo aqui.",
      );
      return;
    }

    await sendMessage(
      env,
      chat.id,
      "iPhone seleccionado. Todavia no hay un instalable iOS publicado desde el bot. El siguiente paso sera generar el build firmado y dejar el enlace listo aqui.",
    );
    return;
  }

  const cursor = await parseSignedHistoryCursor(callbackData, config.botSessionSecret);
  if (cursor === null) {
    await answerCallbackQuery(env, callbackQuery.id, "Cursor invalido.");
    return;
  }

  const result = await sendHistoryPage(env, chat.id, cursor.offset, cursor.shownCount);
  await answerCallbackQuery(env, callbackQuery.id);
  await sendMessage(
    env,
    chat.id,
    result.text,
    result.exhausted ? undefined : await historyKeyboard(config.botSessionSecret, result.nextOffset, result.shownCount),
  );
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
