import crypto from "node:crypto";
import { config } from "./config.js";

export function signCallback(payload: string): string {
  return crypto.createHmac("sha256", config.botSessionSecret).update(payload).digest("hex").slice(0, 16);
}

export function buildSignedHistoryCursor(offset: number, shownCount: number): string {
  const payload = `historial:${offset}:${shownCount}`;
  return `${payload}:${signCallback(payload)}`;
}

export function parseSignedHistoryCursor(value: string): { offset: number; shownCount: number } | null {
  const match = value.match(/^historial:(\d+):(\d+):([a-f0-9]{16})$/);
  if (!match) return null;

  const [, offsetRaw, shownCountRaw, signature] = match;
  const payload = `historial:${offsetRaw}:${shownCountRaw}`;
  if (signCallback(payload) !== signature) return null;

  const offset = Number(offsetRaw);
  const shownCount = Number(shownCountRaw);
  if (!Number.isFinite(offset) || offset < 0) return null;
  if (!Number.isFinite(shownCount) || shownCount < 0) return null;
  return { offset, shownCount };
}
