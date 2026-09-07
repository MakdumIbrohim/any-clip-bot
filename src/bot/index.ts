import { Bot, InlineKeyboard } from "grammy";
import { currentAccessMode, registerAdminCommands } from "../admin.js";
import { config } from "../config.js";
import { ensureUser, logEvent, quotaUsed, effectiveDailyLimit } from "../db.js";
import {
  PLATFORM_LABEL,
  detectPlatform,
  extractUrl,
  type Platform,
} from "../platforms/index.js";
import {
  ExtractError,
  cancelJob,
  enqueue,
  fetchInfo,
  initQueue,
  queueDepth,
  runDownload,
  type DownloadJob,
  type VideoInfo,
} from "../services/index.js";
import { checkAccess, checkQuota, isAdmin } from "./guards.js";
import { buildImagePreview, buildVideoPreview } from "./keyboards.js";
import { handleJobResult } from "./sender.js";
import { esc, pending, progressBar, takePending } from "./utils.js";

export const bot = new Bot(config.botToken);

const activeByChat = new Map<string, DownloadJob>();

function jobKey(chatId: number, userId: number): string {
  return `${chatId}:${userId}`;
}

function findActiveForChat(chatId: number, userId: number): DownloadJob[] {
  const j = activeByChat.get(jobKey(chatId, userId));
  return j && !j.cancelled ? [j] : [];
}

function describeError(err: unknown): string {
  if (err instanceof ExtractError) {
    return `❌ ${err.message}\n\nJika link benar tapi tetap gagal, kemungkinan konten privat/hapus/dibatasi, atau extractor perlu diperbarui.`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `❌ Terjadi kesalahan: ${msg.slice(0, 200)}\nSilakan coba lagi. Jika berulang, hubungi admin.`;
}

async function sendPreview(
  chatId: number,
  userId: number,
  info: VideoInfo,
  platform: Platform
) {
  if (info.isImage) {
    const { caption, keyboard } = buildImagePreview(info, platform, userId);
    if (info.thumbnail) {
      await bot.api
        .sendPhoto(chatId, info.thumbnail, {
          caption,
          parse_mode: "HTML",
          reply_markup: keyboard,
        })
        .catch(() =>
          bot.api.sendMessage(chatId, caption, {
            parse_mode: "HTML",
            reply_markup: keyboard,
          })
        );
    } else {
      await bot.api.sendMessage(chatId, caption, {
        parse_mode: "HTML",
        reply_markup: keyboard,
      });
    }
    return;
  }

  const hasAudio = info.formats.some((f) => f.acodec !== "none");
  const hasVideo = info.formats.some((f) => f.vcodec !== "none");
  if (!hasVideo && !hasAudio) {
    await bot.api.sendMessage(
      chatId,
      "❌ Konten ini tidak memiliki format video atau audio yang bisa diunduh."
    );
    return;
  }

  const { caption, keyboard } = buildVideoPreview(info, platform, userId);
  if (info.thumbnail) {
    await bot.api
      .sendPhoto(chatId, info.thumbnail, {
        caption,
        parse_mode: "HTML",
        reply_markup: keyboard,
      })
      .catch(async () => {
        await bot.api.sendMessage(chatId, caption, {
          parse_mode: "HTML",
          reply_markup: keyboard,
        });
      });
  } else {
    await bot.api.sendMessage(chatId, caption, {
      parse_mode: "HTML",
      reply_markup: keyboard,
    });
  }
}

// Commands
bot.command(["start", "help"], async (ctx) => {
  const text = [
    "🎬 <b>Snap Save Kit Bot</b>",
    "",
    "Kirim link video dari <b>YouTube, TikTok, Instagram, Facebook, X, atau Threads</b> — bot akan menampilkan pratinjau lalu kamu pilih format:",
    "• 🎥 Video MP4 (resolusi sesuai sumber)",
    "• 🎵 Audio MP3",
    "",
    `Kuota harian: <b>${effectiveDailyLimit()}</b> unduhan/hari.`,
    "",
    "Perintah:",
    "/cancel — batalkan unduhan berjalan",
    "/status — cek kuota & posisi antrian",
    "",
    "⚠️ <i>Disclaimer: gunakan hanya untuk konten milik sendiri atau yang berizin. Mengunduh konten pihak ketiga dapat melanggar ketentuan platform dan hak cipta. Bot tidak menyimpan file Anda.</i>",
  ].join("\n");
  await ctx.reply(text, { parse_mode: "HTML" });
});

bot.command("status", async (ctx) => {
  const userId = ctx.from?.id;
  if (!userId) return;
  ensureUser(userId, ctx.from?.username);
  const limit = effectiveDailyLimit();
  const used = quotaUsed(userId);
  await ctx.reply(
    `Kuota hari ini: ${used}/${limit}\nPosisi antrian saat ini: ${queueDepth()} job.\nMode akses: ${currentAccessMode()}.`
  );
});

bot.command("cancel", async (ctx) => {
  const from = ctx.from;
  if (!from) return;
  const chatId = ctx.chat.id;
  let cancelled = false;
  for (const job of findActiveForChat(chatId, from.id)) {
    cancelJob(job);
    cancelled = true;
  }
  await ctx.reply(cancelled ? "Unduhan dibatalkan." : "Tidak ada unduhan aktif.");
});

// Message handler
bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;
  const accessErr = checkAccess(ctx);
  if (accessErr) return ctx.reply(accessErr);

  const url = extractUrl(text);
  if (!url) return ctx.reply("Kirim tautan video, contoh: https://youtu.be/xxxx");

  const platform = detectPlatform(url);
  if (!platform) {
    logEvent(ctx.from.id, null, null, false, `unsupported url: ${url.slice(0, 120)}`);
    return ctx.reply(
      "Platform link ini belum didukung. Yang didukung: YouTube, TikTok, Instagram, Facebook, X, Threads."
    );
  }

  const quotaErr = checkQuota(ctx.from.id);
  if (quotaErr) return ctx.reply(quotaErr);

  const ack = await ctx.reply(
    `🔎 Link ${PLATFORM_LABEL[platform]} terdeteksi. Mengambil info video…`
  );

  try {
    const info = await fetchInfo(url, platform);
    await ctx.api.deleteMessage(ctx.chat.id, ack.message_id).catch(() => {});
    ensureUser(ctx.from.id, ctx.from.username);
    await sendPreview(ctx.chat.id, ctx.from.id, info, platform);
  } catch (err) {
    await ctx.api.deleteMessage(ctx.chat.id, ack.message_id).catch(() => {});
    const message = describeError(err);
    logEvent(ctx.from.id, platform, null, false, message.slice(0, 200));
    await ctx.reply(message);
  }
});

// Callback query handler
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const fromId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const accessErr = checkAccess(ctx);
  if (!fromId || !chatId) return ctx.answerCallbackQuery();
  if (accessErr) {
    return ctx.answerCallbackQuery({
      text: accessErr.slice(0, 190),
      show_alert: true,
    });
  }

  const m = data.match(/^dl:(\w+):([vai])(\d*)$/);
  if (!m) return ctx.answerCallbackQuery();
  const [, token, kind, heightStr] = m;

  const p = takePending(token);
  if (!p) {
    return ctx.answerCallbackQuery({
      text: "Pilihan sudah kedaluwarsa/dipakai. Kirim ulang link videonya ya.",
      show_alert: true,
    });
  }
  if (p.userId !== fromId) {
    pending.set(token, p);
    return ctx.answerCallbackQuery({
      text: "Hanya pengirim link yang bisa memilih.",
      show_alert: true,
    });
  }

  const quotaErr = checkQuota(fromId);
  if (quotaErr) {
    return ctx.answerCallbackQuery({
      text: quotaErr.slice(0, 190),
      show_alert: true,
    });
  }

  const kindObj =
    kind === "a"
      ? ({ type: "audio" } as const)
      : kind === "i"
        ? ({ type: "image" } as const)
        : ({ type: "video", height: Number(heightStr) } as const);

  await ctx.answerCallbackQuery({ text: "Masuk antrian pemrosesan…" });
  const previewMsgId = (
    ctx.callbackQuery.message as { message_id?: number } | undefined
  )?.message_id;
  if (previewMsgId) {
    await ctx.api
      .editMessageCaption(chatId, previewMsgId, {
        caption: `⏳ <b>Dimasukkan ke antrian…</b>\n${esc(p.info.title.slice(0, 120))}`,
        parse_mode: "HTML",
        reply_markup: new InlineKeyboard(),
      })
      .catch(() => {});
  }

  const status = await bot.api.sendMessage(
    chatId,
    queueDepth() > 0 ? `⏳ Dalam antrian (${queueDepth()} job)…` : "⏳ Mempersiapkan unduhan…"
  );

  const key = jobKey(chatId, fromId);
  const job = enqueue({
    chatId,
    userId: fromId,
    platform: p.platform,
    kind: kindObj,
    info: p.info,
    statusMessageId: status.message_id,
  });
  activeByChat.set(key, job);
  job.promise.finally(() => activeByChat.delete(key));

  const result = await job.promise;
  await handleJobResult(bot, chatId, job, result);
});

initQueue(runDownload, (job, percent, stage) => {
  if (!job.statusMessageId) return;
  const text =
    percent !== null ? `⏳ ${stage}\n${progressBar(percent)}` : `⏳ ${stage}`;
  void bot.api
    .editMessageText(job.chatId, job.statusMessageId, text)
    .catch(() => {});
});

registerAdminCommands(bot, { isAdmin });

bot.catch((err) => {
  console.error("[bot] unhandled error:", err.error ?? err);
});
