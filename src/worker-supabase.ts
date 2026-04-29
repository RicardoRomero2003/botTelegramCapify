import type { AuthenticatedUser, BotAuthSession } from "./lib/types.js";
import { getWorkerConfig } from "./worker-config.js";

const SYNTHETIC_AUTH_DOMAIN = "users.capify.local";

type SupabaseTokenResponse = {
  access_token: string;
  refresh_token: string;
};

function normalizeIdentifier(rawIdentifier: string): string {
  return rawIdentifier
    .normalize("NFKC")
    .replace(/["'\u201c\u201d\u2018\u2019]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isEmail(identifier: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier);
}

function buildLocalPart(identifier: string): string {
  const transliterated = identifier
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const cleaned = transliterated
    .replace(/[^a-z0-9._-]+/g, ".")
    .replace(/[.]{2,}/g, ".")
    .replace(/^[-._]+|[-._]+$/g, "");

  return cleaned.slice(0, 50);
}

function resolveSupabaseEmail(rawIdentifier: string): string {
  const identifier = normalizeIdentifier(rawIdentifier);
  if (!identifier) {
    throw new Error("Usuario invalido. Introduce al menos una letra o numero.");
  }

  if (isEmail(identifier)) return identifier;

  const localPart = buildLocalPart(identifier);
  if (!localPart) {
    throw new Error("Usuario invalido. Introduce al menos una letra o numero.");
  }

  return `${localPart}@${SYNTHETIC_AUTH_DOMAIN}`;
}

function mapAuthError(message: string): string {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("invalid login credentials")) return "Credenciales invalidas.";
  if (normalized.includes("email not confirmed")) return "El usuario existe pero no tiene el correo confirmado en Supabase.";
  if (normalized.includes("email address") && normalized.includes("invalid")) return "Usuario invalido.";
  return message;
}

async function parseError(response: Response): Promise<string> {
  const bodyText = await response.text().catch(() => "");
  if (!bodyText) return `Error ${response.status}`;

  try {
    const payload = JSON.parse(bodyText) as {
      error_description?: string;
      error?: string;
      msg?: string;
      message?: string;
      detail?: string;
    };
    return payload.error_description ?? payload.detail ?? payload.message ?? payload.msg ?? payload.error ?? bodyText;
  } catch {
    return bodyText;
  }
}

async function fetchJson<T>(input: string, init: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  if (!response.ok) {
    throw new Error(await parseError(response));
  }
  return response.json() as Promise<T>;
}

export async function fetchAuthenticatedUser(accessToken: string, env: Env): Promise<AuthenticatedUser> {
  const config = getWorkerConfig(env);
  const response = await fetch(`${config.capifyApiBaseUrl}/me`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<AuthenticatedUser>;
}

export async function signInWithSupabase(usuario: string, password: string, env: Env): Promise<BotAuthSession> {
  const config = getWorkerConfig(env);
  const email = resolveSupabaseEmail(usuario);
  const tokenUrl = `${config.supabaseUrl}/auth/v1/token?grant_type=password`;

  const tokenResponse = await fetchJson<SupabaseTokenResponse>(tokenUrl, {
    method: "POST",
    headers: {
      apikey: config.supabasePublishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  }).catch((error: Error) => {
    throw new Error(mapAuthError(error.message));
  });

  const user = await fetchAuthenticatedUser(tokenResponse.access_token, env);

  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    user,
  };
}

export async function refreshSupabaseSession(refreshToken: string, env: Env): Promise<Pick<BotAuthSession, "accessToken" | "refreshToken">> {
  const config = getWorkerConfig(env);
  const tokenUrl = `${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`;

  const tokenResponse = await fetchJson<SupabaseTokenResponse>(tokenUrl, {
    method: "POST",
    headers: {
      apikey: config.supabasePublishableKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: refreshToken }),
  }).catch((error: Error) => {
    throw new Error(mapAuthError(error.message));
  });

  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
  };
}
