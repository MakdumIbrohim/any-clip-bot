import type { Bot, Context } from "grammy";
import { config } from "./config.js";
import {
  effectiveDailyLimit,
  getSetting,
  quotaUsed,
  recentErrors,
  setBlocked,
  setSetting,
  statsSummary,
  topUsers,
} from "./db.js";

export function registerAdminCommands(
  bot: Bot,
  guards: { isAdmin(userId: number): boolean }
): void {
  const guard = (ctx: Context): boolean => {
    const ok = !!ctx.from && guards.isAdmin(ctx.from.id);
    if (!ok) void ctx.reply("Perintah admin: akses ditolak.");
    return ok;
  };

  const argAt = (ctx: Context, i = 1): string => (ctx.message?.text ?? "").split(/\s+/)[i] ?? "";

  bot.command("stats", async (ctx) => {
    if (!guard(ctx)) return;
    const s = statsSummary();
    const rate = s.requests24h ? Math.round((s.success24h / s.requests24h) * 100) : 0;
    const lines = [
      "📊 <b>Statistik 24 jam terakhir</b>",
      `Permintaan: ${s.requests24h} • Sukses: ${s.success24h} • Gagal: ${s.failed24h} (${rate}% sukses)`,
      `Pengguna aktif: ${s.activeUsers24h} • Rata-rata proses: ${s.avgMs ? Math.round(s.avgMs / 100) / 10 : "-"}s`,
      `Kuota harian aktif: ${effectiveDailyLimit()}`,
      "",
      "<b>Per platform:</b>",
      ...(s.byPlatform.length
        ? s.byPlatform.map((p) => `• ${p.platform}: ${p.success}/${p.total}`)
        : ["(belum ada data)"]),
      "",
      "<b>Top downloader:</b>",
      ...topUsers(5).map((u) => `• <code>${u.user_id}</code> ${u.username ? `(@${u.username}) ` : ""}${u.total_downloads}`),
      "",
      "<b>Error terbaru:</b>",
      ...(recentErrors(5).length
        ? recentErrors(5).map(
            (e) => `• ${new Date(e.ts).toISOString().slice(5, 16).replace("T", " ")} <code>${(e.detail ?? "-").slice(0, 80)}</code>`
          )
        : ["(tidak ada)"]),
    ];
    await ctx.reply(lines.join("\n"), { parse_mode: "HTML" });
  });

  bot.command("block", async (ctx) => {
    if (!guard(ctx)) return;
    const id = Number(argAt(ctx));
    if (!Number.isFinite(id)) return ctx.reply("Format: /block <user_id>");
    setBlocked(id, true);
    await ctx.reply(`User ${id} diblokir.`);
  });

  bot.command("unblock", async (ctx) => {
    if (!guard(ctx)) return;
    const id = Number(argAt(ctx));
    if (!Number.isFinite(id)) return ctx.reply("Format: /unblock <user_id>");
    setBlocked(id, false);
    await ctx.reply(`Blokir user ${id} dicabut.`);
  });

  bot.command("limit", async (ctx) => {
    if (!guard(ctx)) return;
    const arg = argAt(ctx);
    if (!arg) return ctx.reply(`Kuota harian saat ini: ${effectiveDailyLimit()}.\nGanti dengan: /limit <jumlah>`);
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1 || n > 10_000) return ctx.reply("Nilai tidak valid (1-10000).");
    setSetting("daily_limit", String(n));
    await ctx.reply(`Kuota harian diubah menjadi ${n} unduhan/pengguna.`);
  });

  bot.command("user", async (ctx) => {
    if (!guard(ctx)) return;
    const id = Number(argAt(ctx));
    if (!Number.isFinite(id)) return ctx.reply("Format: /user <user_id>");
    await ctx.reply(`User ${id}: terpakai hari ini ${quotaUsed(id)}/${effectiveDailyLimit()}.`);
  });

  bot.command("mode", async (ctx) => {
    if (!guard(ctx)) return;
    const arg = argAt(ctx);
    if (arg !== "public" && arg !== "whitelist") {
      return ctx.reply(`Mode saat ini: ${currentAccessMode()}.\nGanti dengan: /mode public|whitelist`);
    }
    setSetting("access_mode", arg);
    await ctx.reply(`Mode akses diubah ke ${arg}.`);
  });
}

export function currentAccessMode(): "public" | "whitelist" {
  const v = getSetting("access_mode", "");
  return v === "public" || v === "whitelist" ? v : config.accessMode;
}
