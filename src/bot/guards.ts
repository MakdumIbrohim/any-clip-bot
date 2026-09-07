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
