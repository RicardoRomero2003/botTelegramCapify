export type WorkerConfig = {
  telegramBotToken: string;
  telegramAllowedChatIds: Set<number>;
  supabaseUrl: string;
  supabasePublishableKey: string;
  capifyApiBaseUrl: string;
  botSessionSecret: string;
};

function readRequired(value: string | undefined, name: string): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    throw new Error(`Falta la variable de entorno obligatoria ${name}.`);
  }
  return trimmed;
}

function parseAllowedChatIds(raw: string | undefined): Set<number> {
  const value = (raw ?? "").trim();
  if (!value) return new Set();

  return new Set(
    value
      .split(",")
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item)),
  );
}

export function getWorkerConfig(env: Env): WorkerConfig {
  const supabasePublishableKey =
    ((env as unknown as Record<string, string | undefined>).SUPABASE_PUBLISHABLE_KEY ?? "").trim() ||
    (env.SUPABASE_ANON_KEY ?? "").trim();

  if (!supabasePublishableKey) {
    throw new Error("Falta SUPABASE_PUBLISHABLE_KEY o SUPABASE_ANON_KEY en Cloudflare.");
  }

  return {
    telegramBotToken: readRequired(env.TELEGRAM_BOT_TOKEN, "TELEGRAM_BOT_TOKEN"),
    telegramAllowedChatIds: parseAllowedChatIds(env.TELEGRAM_ALLOWED_CHAT_IDS),
    supabaseUrl: readRequired(env.SUPABASE_URL, "SUPABASE_URL"),
    supabasePublishableKey,
    capifyApiBaseUrl: readRequired(env.CAPIFY_API_BASE_URL, "CAPIFY_API_BASE_URL").replace(/\/$/, ""),
    botSessionSecret: readRequired(env.BOT_SESSION_SECRET, "BOT_SESSION_SECRET"),
  };
}
