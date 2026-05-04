const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return toHex(signature).slice(0, 16);
}

export async function buildSignedHistoryCursor(offset: number, shownCount: number, secret: string): Promise<string> {
  const payload = `historial:${offset}:${shownCount}`;
  return `${payload}:${await sign(payload, secret)}`;
}

export async function parseSignedHistoryCursor(
  value: string,
  secret: string,
): Promise<{ offset: number; shownCount: number } | null> {
  const match = value.match(/^historial:(\d+):(\d+):([a-f0-9]{16})$/);
  if (!match) return null;

  const [, offsetRaw, shownCountRaw, signature] = match;
  const payload = `historial:${offsetRaw}:${shownCountRaw}`;
  const expected = await sign(payload, secret);
  if (expected !== signature) return null;

  const offset = Number(offsetRaw);
  const shownCount = Number(shownCountRaw);
  if (!Number.isFinite(offset) || offset < 0) return null;
  if (!Number.isFinite(shownCount) || shownCount < 0) return null;
  return { offset, shownCount };
}

export async function buildWebhookSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${secret}:telegram-webhook`));
  return toHex(digest).slice(0, 32);
}
