import { config } from "./config.js";
import type { BotAuthSession, ExpenseHistoryPage, FinancialMovement } from "./types.js";
import { fetchAuthenticatedUser, refreshSupabaseSession } from "./supabaseAuth.js";

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

async function authorizedFetch(path: string, session: BotAuthSession): Promise<Response> {
  let response = await fetch(`${config.capifyApiBaseUrl}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  if (response.status !== 401) return response;

  const refreshed = await refreshSupabaseSession(session.refreshToken);
  session.accessToken = refreshed.accessToken;
  session.refreshToken = refreshed.refreshToken;
  session.user = await fetchAuthenticatedUser(session.accessToken);

  response = await fetch(`${config.capifyApiBaseUrl}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
    },
  });

  return response;
}

export async function getExpenseHistoryPage(session: BotAuthSession, startOffset: number, pageSize = 20): Promise<ExpenseHistoryPage> {
  const expenses: FinancialMovement[] = [];
  let offset = Math.max(0, startOffset);
  const batchSize = 100;

  while (true) {
    const response = await authorizedFetch(`/financial-settings/me/transactions?limit=${batchSize}&offset=${offset}`, session);
    if (!response.ok) {
      throw new Error(await parseError(response));
    }

    const payload = (await response.json()) as { items?: FinancialMovement[] };
    const items = Array.isArray(payload.items) ? payload.items : [];

    if (items.length === 0) {
      return {
        expenses,
        nextOffset: offset,
        consumedCount: expenses.length,
        exhausted: true,
      };
    }

    for (const [index, item] of items.entries()) {
      if (String(item.tipo).toLowerCase() === "gasto") {
        expenses.push(item);
        if (expenses.length >= pageSize) {
          const nextOffset = offset + index + 1;
          const exhausted = nextOffset >= offset + items.length && items.length < batchSize;
          return {
            expenses,
            nextOffset,
            consumedCount: expenses.length,
            exhausted,
          };
        }
      }
    }

    offset += items.length;
    if (items.length < batchSize) {
      return {
        expenses,
        nextOffset: offset,
        consumedCount: expenses.length,
        exhausted: true,
      };
    }
  }
}
