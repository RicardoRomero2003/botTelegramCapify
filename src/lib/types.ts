export type AuthenticatedUser = {
  authenticated: boolean;
  uid: string;
  user_id: number;
  correo: string;
  usuario: string;
  plan?: string;
};

export type BotAuthSession = {
  accessToken: string;
  refreshToken: string;
  user: AuthenticatedUser;
};

export type ExpenseCategory = "DEPORTE" | "TRANSPORTE" | "OCIO" | "COMIDA" | "OTROS";
export type ExpenseKind = "MENSUALIDAD" | "PUNTUAL";
export type ExpensePaymentMethod = "Cuenta de gastos" | "Tarjeta de Ineco";
export type ExpenseTransportType = "Transporte Publico" | "Uber" | "Gasolina";

export type ExpenseDraft = {
  categoria?: ExpenseCategory;
  nombre?: string;
  precio?: number;
  fecha?: string;
  tipo?: ExpenseKind;
  forma_pago?: ExpensePaymentMethod;
  tipo_transporte?: ExpenseTransportType;
  ubicacion?: string;
};

export type ExpenseFlowState = {
  step:
    | "category"
    | "name"
    | "transport_type"
    | "location"
    | "price"
    | "date"
    | "kind"
    | "payment_method"
    | "confirm";
  draft: ExpenseDraft;
};

export type BotChatState = {
  auth: BotAuthSession | null;
  loginFlow:
    | null
    | {
        step: "usuario" | "password";
        usuario?: string;
      };
  expenseFlow: ExpenseFlowState | null;
  history: {
    nextOffset: number;
    exhausted: boolean;
  } | null;
};

export type FinancialMovement = {
  id: number;
  tipo: string;
  categoria: string;
  monto: number;
  descripcion: string | null;
  fecha_operacion: string;
  created_at: string;
};

export type ExpenseHistoryPage = {
  expenses: FinancialMovement[];
  nextOffset: number;
  exhausted: boolean;
};

export type FinancialExpenseCreatePayload = {
  categoria: string;
  nombre?: string;
  precio: number;
  fecha: string;
  tipo: string;
  forma_pago: string;
  tipo_transporte?: string;
  ubicacion?: string;
};

export type FinancialExpenseCreateResponse = {
  expense_id: number;
  message: string;
  transaction: FinancialMovement;
};
