import type {
  BotAuthSession,
  ExpenseHistoryPage,
  FinancialExpenseCreatePayload,
  FinancialExpenseCreateResponse,
  FinancialMovement,
} from "./lib/types.js";
import { getWorkerConfig } from "./worker-config.js";
import { fetchAuthenticatedUser, refreshSupabaseSession } from "./worker-supabase.js";

function compareMovementsDesc(a: FinancialMovement, b: FinancialMovement): number {
  const dateA = `${a.fecha_operacion}|${a.created_at}|${a.id}`;
  const dateB = `${b.fecha_operacion}|${b.created_at}|${b.id}`;
  return dateA < dateB ? 1 : dateA > dateB ? -1 : 0;
}

async function parseError(response: Response): Promise<string> {
  const bodyText = await response.text().catch(() => "");
  if (!bodyText) return `Error ${response.status}`;

  try {
    const payload = JSON.parse(bodyText) as { detail?: string; message?: string };
    return payload.detail ?? payload.message ?? bodyText;
  } catch {
    return bodyText;
  }
}

async function authorizedFetch(path: string, session: BotAuthSession, env: Env): Promise<Response> {
  const config = getWorkerConfig(env);
  let response = await fetch(`${config.capifyApiBaseUrl}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (response.status !== 401) return response;

  const refreshed = await refreshSupabaseSession(session.refreshToken, env);
  session.accessToken = refreshed.accessToken;
  session.refreshToken = refreshed.refreshToken;
  session.user = await fetchAuthenticatedUser(session.accessToken, env);

  response = await fetch(`${config.capifyApiBaseUrl}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  return response;
}

async function authorizedRequest(path: string, session: BotAuthSession, env: Env, init: RequestInit): Promise<Response> {
  const config = getWorkerConfig(env);
  const headers = new Headers(init.headers ?? {});
  headers.set("Authorization", `Bearer ${session.accessToken}`);

  let response = await fetch(`${config.capifyApiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  if (response.status !== 401) return response;

  const refreshed = await refreshSupabaseSession(session.refreshToken, env);
  session.accessToken = refreshed.accessToken;
  session.refreshToken = refreshed.refreshToken;
  session.user = await fetchAuthenticatedUser(session.accessToken, env);

  headers.set("Authorization", `Bearer ${session.accessToken}`);
  response = await fetch(`${config.capifyApiBaseUrl}${path}`, {
    ...init,
    headers,
  });

  return response;
}

export async function getExpenseHistoryPage(session: BotAuthSession, startOffset: number, pageSize: number, env: Env): Promise<ExpenseHistoryPage> {
  let offset = Math.max(0, startOffset);
  const response = await authorizedFetch(`/financial-settings/me/transactions?limit=${pageSize}&offset=${offset}`, session, env);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const payload = (await response.json()) as { items?: FinancialMovement[] };
  const items = (Array.isArray(payload.items) ? payload.items : []).sort(compareMovementsDesc);
  const consumedCount = items.length;
  offset += consumedCount;

  return {
    expenses: items,
    nextOffset: offset,
    consumedCount,
    exhausted: consumedCount < pageSize,
  };
}

export async function createFinancialExpense(
  session: BotAuthSession,
  payload: FinancialExpenseCreatePayload,
  env: Env,
): Promise<FinancialExpenseCreateResponse> {
  const response = await authorizedRequest("/financial-settings/me/expenses", session, env, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return (await response.json()) as FinancialExpenseCreateResponse;
}
