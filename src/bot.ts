import { Bot, InlineKeyboard, InputFile } from "grammy";
import crypto from "node:crypto";
import { config } from "./config.js";
import {
  ensureUser,
  effectiveDailyLimit,
  isBlocked,
  logEvent,
  quotaUsed,
} from "./db.js";
import {
  PLATFORM_LABEL,
  detectPlatform,
  extractUrl,
  type Platform,
} from "./detect.js";
import { ExtractError, fetchInfo, type VideoInfo } from "./extractor.js";
import {
  availableHeights,
  cleanupJobDir,
  estimateAudioSize,
  estimateVideoSize,
  formatBytes,
  formatDuration,
  runDownload,
} from "./downloader.js";
import {
  enqueue,
  queueDepth,
  cancelJob,
  initQueue,
  type DownloadJob,
} from "./queue.js";
import { registerAdminCommands, currentAccessMode } from "./admin.js";

export const bot = new Bot(config.botToken);

type Pending = {
  info: VideoInfo;
  platform: Platform;
  userId: number;
  expires: number;
};
const pending = new Map<string, Pending>();

function newToken(): string {
  return crypto.randomBytes(5).toString("hex");
}

function takePending(token: string): Pending | undefined {
  const p = pending.get(token);
  if (!p) return;
  pending.delete(token);
  if (p.expires < Date.now()) return;
  return p;
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of pending) if (v.expires < now) pending.delete(k);
}, 60_000).unref();

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function isAdmin(userId: number): boolean {
  return config.adminIds.has(userId);
}

function checkAccess(ctx: { from?: { id: number } }): string | null {
  const from = ctx.from;
  if (!from) return "Pesan harus dari pengguna, bukan channel.";
  if (isBlocked(from.id))
    return "Anda diblokir dari penggunaan bot ini. Hubungi admin.";
  if (isAdmin(from.id)) return null;
  if (
    currentAccessMode() === "whitelist" &&
    !config.whitelistIds.has(from.id)
  ) {
    return "Bot ini sedang dalam mode whitelist. Minta akses ke admin.";
  }
  return null;
}

function checkQuota(userId: number): string | null {
  if (isAdmin(userId)) return null;
  const limit = effectiveDailyLimit();
  const used = quotaUsed(userId);
  if (used >= limit) {
    return `Kuota harian habis (${used}/${limit}). Kuota reset tiap tengah malam. Coba lagi besok atau hubungi admin.`;
  }
  return null;
}

bot.command(["start", "help"], async (ctx) => {
  const text = [
    "🎬 <b>AnyClip Bot</b>",
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
    `Kuota hari ini: ${used}/${limit}\nPosisi antrian saat ini: ${queueDepth()} job.\nMode akses: ${currentAccessMode()}.`,
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
  await ctx.reply(
    cancelled ? "Unduhan dibatalkan." : "Tidak ada unduhan aktif.",
  );
});

const activeByChat = new Map<string, DownloadJob>();
function jobKey(chatId: number, userId: number) {
  return `${chatId}:${userId}`;
}
function findActiveForChat(chatId: number, userId: number): DownloadJob[] {
  const j = activeByChat.get(jobKey(chatId, userId));
  return j && !j.cancelled ? [j] : [];
}

bot.on("message:text", async (ctx) => {
  const text = ctx.message.text;
  if (text.startsWith("/")) return;
  const accessErr = checkAccess(ctx);
  if (accessErr) return ctx.reply(accessErr);

  const url = extractUrl(text);
  if (!url)
    return ctx.reply("Kirim tautan video, contoh: https://youtu.be/xxxx");

  const platform = detectPlatform(url);
  if (!platform) {
    logEvent(
      ctx.from.id,
      null,
      null,
      false,
      `unsupported url: ${url.slice(0, 120)}`,
    );
    return ctx.reply(
      "Platform link ini belum didukung. Yang didukung: YouTube, TikTok, Instagram, Facebook, X, Threads.",
    );
  }

  const quotaErr = checkQuota(ctx.from.id);
  if (quotaErr) return ctx.reply(quotaErr);

  const ack = await ctx.reply(
    `🔎 Link ${PLATFORM_LABEL[platform]} terdeteksi. Mengambil info video…`,
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
  platform: Platform,
) {
  const token = newToken();
  pending.set(token, {
    info,
    platform,
    userId,
    expires: Date.now() + config.previewTtlMin * 60_000,
  });

  const heights = availableHeights(info);
  const kb = new InlineKeyboard();
  const lines: string[] = [];
  lines.push(`📌 <b>${esc(info.title.slice(0, 150))}</b>`);
  lines.push(
    `Platform: ${PLATFORM_LABEL[platform]}${info.uploader ? ` • ${esc(info.uploader.slice(0, 60))}` : ""}`,
  );
  lines.push(
    `Durasi: ${info.isLive ? "🔴 LIVE" : formatDuration(info.duration)}`,
  );
  lines.push("");
  lines.push("Pilih format:");

  for (const h of heights.slice(0, 5)) {
    const size = estimateVideoSize(info, h);
    const label = `🎥 MP4 ${h}p${size ? ` • ~${formatBytes(size)}` : ""}`;
    kb.text(
      label.length > 56
        ? `🎥 ${h}p${size ? ` • ~${formatBytes(size)}` : ""}`
        : label,
      `dl:${token}:v${h}`,
    ).row();
  }
  const audioSize = estimateAudioSize(info);
  kb.text(
    `🎵 MP3 Audio${audioSize ? ` • ~${formatBytes(audioSize)}` : ""}`,
    `dl:${token}:a`,
  ).row();

  const caption = lines.join("\n");
  if (info.thumbnail) {
    await bot.api
      .sendPhoto(chatId, info.thumbnail, {
        caption,
        parse_mode: "HTML",
        reply_markup: kb,
      })
      .catch(async () => {
        await bot.api.sendMessage(chatId, caption, {
          parse_mode: "HTML",
          reply_markup: kb,
        });
      });
  } else {
    await bot.api.sendMessage(chatId, caption, {
      parse_mode: "HTML",
      reply_markup: kb,
    });
  }
}

bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const fromId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  const accessErr = checkAccess(ctx);
  if (!fromId || !chatId) return ctx.answerCallbackQuery();
  if (accessErr)
    return ctx.answerCallbackQuery({
      text: accessErr.slice(0, 190),
      show_alert: true,
    });

  const m = data.match(/^dl:(\w+):([va])(\d*)$/);
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
    queueDepth() > 0
      ? `⏳ Dalam antrian (${queueDepth()} job)…`
      : "⏳ Mempersiapkan unduhan…",
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
  await handleJobResult(chatId, job, result);
});

function progressBar(pct: number): string {
  const filled = Math.max(0, Math.min(20, Math.round(pct / 5)));
  return `${"█".repeat(filled)}${"░".repeat(20 - filled)} ${pct.toFixed(0)}%`;
}

initQueue(runDownload, (job, percent, stage) => {
  if (!job.statusMessageId) return;
  const text =
    percent !== null ? `⏳ ${stage}\n${progressBar(percent)}` : `⏳ ${stage}`;
  void bot.api
    .editMessageText(job.chatId, job.statusMessageId, text)
    .catch(() => {});
});

async function handleJobResult(
  chatId: number,
  job: DownloadJob,
  result: Awaited<DownloadJob["promise"]>,
) {
  const statusId = job.statusMessageId;
  const finish = async (text: string) => {
    if (statusId)
      await bot.api
        .editMessageText(chatId, statusId, text)
        .catch(() => bot.api.sendMessage(chatId, text));
    else await bot.api.sendMessage(chatId, text);
  };

  if (result.ok) {
    try {
      await uploadAndSend(chatId, job, result.path, result.size);
      await (statusId
        ? bot.api.deleteMessage(chatId, statusId).catch(() => {})
        : Promise.resolve());
    } catch (err) {
      await finish(
        `❌ Gagal mengirim file: ${(err as Error).message.slice(0, 200)}`,
      );
    } finally {
      cleanupJobDir(job);
    }
    return;
  }

  if (!result.ok && result.code === "too_big") {
    cleanupJobDir(job);
    const lower = availableHeights(job.info).filter(
      (h) => h < (job.kind.type === "video" ? job.kind.height : 1e9),
    );
    await finish(
      `❌ Ukuran file ${formatBytes(result.size)} melebihi batas kirim bot (${config.maxUploadMb} MB).` +
        (lower.length
          ? `\nCoba resolusi lebih rendah: ${lower.slice(0, 3).join("p / ")}p, atau pilih MP3.`
          : "\nPilih format MP3 saja sebagai alternatif."),
    );
    return;
  }

  if (!result.ok && result.code === "cancelled") {
    cleanupJobDir(job);
    await finish("🚫 Unduhan dibatalkan.");
    return;
  }

  cleanupJobDir(job);
  await finish(
    `❌ ${(result.code === "error" ? result.message : "Kesalahan tidak diketahui.").slice(0, 300)}`,
  );
}

async function uploadAndSend(
  chatId: number,
  job: DownloadJob,
  filePath: string,
  size: number,
) {
  const isAudio = job.kind.type === "audio";
  const caption = `${isAudio ? "🎵" : "🎬"} ${job.info.title.slice(0, 100)}\n${PLATFORM_LABEL[job.platform]} • ${formatBytes(size)}`;

  const videoName = `${sanitize(job.info.title)}.mp4`;
  const audioName = `${sanitize(job.info.title)}.mp3`;
  const senders = isAudio
    ? [
        () =>
          bot.api.sendAudio(chatId, new InputFile(filePath, audioName), {
            caption,
          }),
        () =>
          bot.api.sendDocument(chatId, new InputFile(filePath, audioName), {
            caption,
          }),
      ]
    : [
        () =>
          bot.api.sendVideo(chatId, new InputFile(filePath, videoName), {
            caption,
            supports_streaming: true,
          }),
        () =>
          bot.api.sendDocument(chatId, new InputFile(filePath), { caption }),
      ];

  let lastErr: unknown;
  for (const send of senders) {
    try {
      await send();
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("pengiriman gagal");
}

function sanitize(s: string): string {
  return (
    s
      .replace(/[^\w -]/g, "")
      .trim()
      .slice(0, 40) || "video"
  );
}

registerAdminCommands(bot, { isAdmin });

bot.catch((err) => {
  console.error("[bot] unhandled error:", err.error ?? err);
});
