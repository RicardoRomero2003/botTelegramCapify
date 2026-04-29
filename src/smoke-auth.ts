import { getExpenseHistoryPage } from "./lib/capifyApi.js";
import { signInWithSupabase } from "./lib/supabaseAuth.js";

const usuario = (process.env.BOT_TEST_USERNAME ?? "").trim();
const password = (process.env.BOT_TEST_PASSWORD ?? "").trim();

async function main(): Promise<void> {
  if (!usuario || !password) {
    throw new Error("Faltan BOT_TEST_USERNAME y BOT_TEST_PASSWORD para la prueba autenticada.");
  }

  const session = await signInWithSupabase(usuario, password);
  const page = await getExpenseHistoryPage(session, 0, 20);

  console.log(JSON.stringify({
    usuario: session.user.usuario,
    userId: session.user.user_id,
    expensesReturned: page.expenses.length,
    nextOffset: page.nextOffset,
    exhausted: page.exhausted,
    firstExpense: page.expenses[0] ?? null,
  }, null, 2));
}

void main();
