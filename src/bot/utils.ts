import crypto from "node:crypto";
import type { Platform } from "../platforms/index.js";
import type { VideoInfo } from "../services/index.js";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function sanitize(s: string): string {
  return (
    s
      .replace(/[^\w -]/g, "")
      .trim()
      .slice(0, 40) || "video"
  );
}

export function progressBar(pct: number): string {
  const filled = Math.max(0, Math.min(20, Math.round(pct / 5)));
  return `${"█".repeat(filled)}${"░".repeat(20 - filled)} ${pct.toFixed(0)}%`;
}

export type Pending = {
  info: VideoInfo;
  platform: Platform;
  userId: number;
  expires: number;
};

export const pending = new Map<string, Pending>();

export function newToken(): string {
  return crypto.randomBytes(5).toString("hex");
}

export function takePending(token: string): Pending | undefined {
  const p = pending.get(token);
  if (!p) return;
  pending.delete(token);
  if (p.expires < Date.now()) return;
  return p;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) {
    if (v.expires < now) pending.delete(k);
  }
}, 60_000).unref();
