import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../.env") });

type EnvConfig = {
  telegramBotToken: string;
  telegramAllowedChatIds: Set<number>;
  supabaseUrl: string;
  supabasePublishableKey: string;
  supabaseServiceRoleKey: string | null;
  capifyApiBaseUrl: string;
  botSessionSecret: string;
};

function readRequired(name: string): string {
  const value = (process.env[name] ?? "").trim();
  if (!value) {
    throw new Error(`Falta la variable de entorno obligatoria ${name}.`);
  }
  return value;
}

function readOptional(name: string): string | null {
  const value = (process.env[name] ?? "").trim();
  return value || null;
}

function parseAllowedChatIds(raw: string | null): Set<number> {
  if (!raw) return new Set();
  const values = raw
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
  return new Set(values);
}

const supabasePublishableKey =
  readOptional("SUPABASE_PUBLISHABLE_KEY") ?? readOptional("SUPABASE_ANON_KEY") ?? "";

if (!supabasePublishableKey) {
  throw new Error("Falta SUPABASE_PUBLISHABLE_KEY o SUPABASE_ANON_KEY en bot/.env.");
}

export const config: EnvConfig = {
  telegramBotToken: readRequired("TELEGRAM_BOT_TOKEN"),
  telegramAllowedChatIds: parseAllowedChatIds(readOptional("TELEGRAM_ALLOWED_CHAT_IDS")),
  supabaseUrl: readRequired("SUPABASE_URL"),
  supabasePublishableKey,
  supabaseServiceRoleKey: readOptional("SUPABASE_SERVICE_ROLE_KEY"),
  capifyApiBaseUrl: readRequired("CAPIFY_API_BASE_URL").replace(/\/$/, ""),
  botSessionSecret: readRequired("BOT_SESSION_SECRET"),
};
