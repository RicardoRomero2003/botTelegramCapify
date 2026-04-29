import { config } from "./lib/config.js";

async function main(): Promise<void> {
  const telegramResponse = await fetch(`https://api.telegram.org/bot${config.telegramBotToken}/getMe`);
  if (!telegramResponse.ok) {
    throw new Error(`Telegram getMe fallo con ${telegramResponse.status}`);
  }
  const telegramJson = await telegramResponse.json() as { ok: boolean; result?: { username?: string } };
  if (!telegramJson.ok) {
    throw new Error("Telegram devolvio ok=false en getMe.");
  }

  const apiResponse = await fetch(config.capifyApiBaseUrl);
  if (!apiResponse.ok) {
    throw new Error(`Capify API base fallo con ${apiResponse.status}`);
  }

  const apiJson = await apiResponse.json() as { message?: string };

  console.log(JSON.stringify({
    telegramBot: telegramJson.result?.username ?? null,
    apiMessage: apiJson.message ?? null,
    allowedChatIdsConfigured: config.telegramAllowedChatIds.size > 0,
    hasServiceRoleKey: Boolean(config.supabaseServiceRoleKey),
  }, null, 2));
}

void main();
