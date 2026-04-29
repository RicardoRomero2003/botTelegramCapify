import type { BotAuthSession, ExpenseHistoryPage, FinancialMovement } from "./lib/types.js";
import { getWorkerConfig } from "./worker-config.js";
import { fetchAuthenticatedUser, refreshSupabaseSession } from "./worker-supabase.js";

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

export async function getExpenseHistoryPage(session: BotAuthSession, startOffset: number, pageSize: number, env: Env): Promise<ExpenseHistoryPage> {
  const expenses: FinancialMovement[] = [];
  let offset = Math.max(0, startOffset);
  let exhausted = false;
  const batchSize = 100;

  while (expenses.length < pageSize && !exhausted) {
    const response = await authorizedFetch(`/financial-settings/me/transactions?limit=${batchSize}&offset=${offset}`, session, env);
    if (!response.ok) {
      throw new Error(await parseError(response));
    }

    const payload = (await response.json()) as { items?: FinancialMovement[] };
    const items = Array.isArray(payload.items) ? payload.items : [];

    if (items.length === 0) {
      exhausted = true;
      break;
    }

    for (const item of items) {
      if (String(item.tipo).toLowerCase() === "gasto") {
        expenses.push(item);
        if (expenses.length >= pageSize) break;
      }
    }

    offset += items.length;
    if (items.length < batchSize) {
      exhausted = true;
    }
  }

  return {
    expenses: expenses.slice(0, pageSize),
    nextOffset: offset,
    exhausted,
  };
}
