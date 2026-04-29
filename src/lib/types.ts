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

export type BotChatState = {
  auth: BotAuthSession | null;
  loginFlow:
    | null
    | {
        step: "usuario" | "password";
        usuario?: string;
      };
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
