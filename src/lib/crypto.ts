import crypto from "node:crypto";
import { config } from "./config.js";

export function signCallback(payload: string): string {
  return crypto.createHmac("sha256", config.botSessionSecret).update(payload).digest("hex").slice(0, 16);
}

export function buildSignedHistoryCursor(offset: number): string {
  const payload = `historial:${offset}`;
  return `${payload}:${signCallback(payload)}`;
}

export function parseSignedHistoryCursor(value: string): number | null {
  const match = value.match(/^historial:(\d+):([a-f0-9]{16})$/);
  if (!match) return null;

  const [, offsetRaw, signature] = match;
  const payload = `historial:${offsetRaw}`;
  if (signCallback(payload) !== signature) return null;

  const offset = Number(offsetRaw);
  if (!Number.isFinite(offset) || offset < 0) return null;
  return offset;
}
