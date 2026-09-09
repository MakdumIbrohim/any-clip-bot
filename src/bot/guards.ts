import { currentAccessMode } from "../admin.js";
import { config } from "../config.js";
import { effectiveDailyLimit, isBlocked, quotaUsed } from "../db.js";

export function isAdmin(userId: number): boolean {
  return config.adminIds.has(userId);
}

export function checkAccess(ctx: { from?: { id: number } }): string | null {
  const from = ctx.from;
  if (!from) return "Pesan harus dari pengguna, bukan channel.";
  if (isBlocked(from.id)) return "Anda diblokir dari penggunaan bot ini. Hubungi admin.";
  if (isAdmin(from.id)) return null;
  if (currentAccessMode() === "whitelist" && !config.whitelistIds.has(from.id)) {
    return "Bot ini sedang dalam mode whitelist. Minta akses ke admin.";
  }
  return null;
}

export function checkQuota(userId: number): string | null {
  if (isAdmin(userId)) return null;
  const limit = effectiveDailyLimit();
  const used = quotaUsed(userId);
  if (used >= limit) {
    return `Kuota harian habis (${used}/${limit}). Kuota reset tiap tengah malam. Coba lagi besok atau hubungi admin.`;
  }
  return null;
}

// In-memory sliding window rate limiter per user
const requestTimestamps = new Map<number, number[]>();

export function checkRateLimit(userId: number): string | null {
  if (isAdmin(userId)) return null;

  const now = Date.now();
  const windowMs = config.rateLimit.windowSec * 1000;
  const maxReq = config.rateLimit.maxRequests;

  const timestamps = requestTimestamps.get(userId) ?? [];
  const validTimestamps = timestamps.filter((t) => now - t < windowMs);

  if (validTimestamps.length >= maxReq) {
    const oldest = validTimestamps[0];
    const retryAfterSec = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    return `⚠️ Terlalu banyak permintaan (spam protection). Harap tunggu ${retryAfterSec} detik sebelum mencoba lagi.`;
  }

  validTimestamps.push(now);
  requestTimestamps.set(userId, validTimestamps);
  return null;
}
