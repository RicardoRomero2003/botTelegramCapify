import type { AuthenticatedUser, ExpenseHistoryPage, FinancialMovement } from "./types.js";

function formatAmount(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function normalizeCategory(value: string): string {
  return value
    .replace(/_/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}

export function formatWelcome(): string {
  return [
    "Capify Bot activo.",
    "",
    "Comandos disponibles:",
    "/login — iniciar sesion",
    "/logout — cerrar sesion",
    "/historial — ver los ultimos 20 gastos",
    "/mas — cargar los siguientes 20 gastos",
  ].join("\n");
}

export function formatLoggedUser(user: AuthenticatedUser): string {
  return [
    "Sesion iniciada correctamente.",
    `Usuario: ${user.usuario}`,
    `UID interno: ${user.user_id}`,
    `Correo Supabase: ${user.correo}`,
  ].join("\n");
}

export function formatExpenseItem(expense: FinancialMovement): string {
  const title = expense.descripcion?.trim() || `Gasto ${normalizeCategory(expense.categoria)}`;
  return `• ${formatDate(expense.fecha_operacion)} | ${normalizeCategory(expense.categoria)} | ${title} | ${formatAmount(expense.monto)}`;
}

export function formatExpenseHistory(page: ExpenseHistoryPage, startIndex: number): string {
  if (page.expenses.length === 0) {
    return "No hay mas gastos para mostrar.";
  }

  const lines = [`Historial de gastos (${startIndex + 1}-${startIndex + page.expenses.length}):`, ""];
  page.expenses.forEach((expense, index) => {
    lines.push(`${startIndex + index + 1}. ${formatExpenseItem(expense)}`);
  });

  if (page.exhausted) {
    lines.push("", "Fin del historial.");
  } else {
    lines.push("", "Usa /mas o el boton 'Mas gastos' para cargar los siguientes 20.");
  }

  return lines.join("\n");
}
