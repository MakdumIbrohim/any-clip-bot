import { Bot, InlineKeyboard, InputFile } from "grammy";
import { config } from "../config.js";
import { PLATFORM_LABEL } from "../platforms/index.js";
import {
  availableHeights,
  cleanupJobDir,
  formatBytes,
  formatDuration,
  type DownloadJob,
} from "../services/index.js";
import { esc, sanitize } from "./utils.js";

function buildSuccessCaption(job: DownloadJob, size: number): string {
  const isAudio = job.kind.type === "audio";
  const isImage = job.kind.type === "image";
  const isSpotify = job.platform === "spotify";

  const icon = isAudio ? "🎵" : isImage ? "📷" : "🎬";
  const lines: string[] = [];

  // Judul
  lines.push(`<b>${esc(job.info.title.slice(0, 150))}</b>`);
  lines.push("");

  // Baris informasi
  lines.push(`🌐 <b>Platform:</b> ${PLATFORM_LABEL[job.platform]}`);

  if (job.info.uploader) {
    const role = isSpotify || isAudio ? "Artis" : "Kreator";
    lines.push(`👤 <b>${role}:</b> ${esc(job.info.uploader)}`);
  }

  if (isSpotify && job.info.album) {
    lines.push(`💿 <b>Album:</b> ${esc(job.info.album)}`);
  }

  if (!isImage && job.info.duration) {
    lines.push(`⏱ <b>Durasi:</b> ${formatDuration(job.info.duration)}`);
  }

  if (job.kind.type === "video") {
    lines.push(
      `📐 <b>Resolusi:</b> ${job.kind.height ? `${job.kind.height}p` : "HD / Asli"}`,
    );
  } else if (job.kind.type === "image" && job.kind.index !== undefined) {
    lines.push(`🖼 <b>Slide:</b> Foto ke-${job.kind.index}`);
  }

  lines.push(`📦 <b>Ukuran:</b> ${formatBytes(size)}`);
  lines.push("");
  lines.push(`⚡ <i>Diunduh via Snap Save Kit Bot</i>`);

  return lines.join("\n");
}

export async function uploadAndSend(
  bot: Bot,
  chatId: number,
  job: DownloadJob,
  filePath: string,
  size: number,
  allPaths?: string[],
): Promise<void> {
  const isAudio = job.kind.type === "audio";
  const isImage = job.kind.type === "image";
  const caption = buildSuccessCaption(job, size);

  // Multi-image album
  if (isImage && allPaths && allPaths.length > 1) {
    const CHUNK_SIZE = 10;
    for (let i = 0; i < allPaths.length; i += CHUNK_SIZE) {
      const chunk = allPaths.slice(i, i + CHUNK_SIZE);
      const media = chunk.map((p, idx) => ({
        type: "photo" as const,
        media: new InputFile(p),
        caption: i === 0 && idx === 0 ? caption : undefined,
        parse_mode: "HTML" as const,
      }));
      await bot.api.sendMediaGroup(chatId, media);
    }
    return;
  }

  const videoName = `${sanitize(job.info.title)}.mp4`;
  const audioName = `${sanitize(job.info.title)}.mp3`;
  const senders = isAudio
    ? [
        () =>
          bot.api.sendAudio(chatId, new InputFile(filePath, audioName), {
            caption,
            parse_mode: "HTML",
            title: job.info.title.slice(0, 100),
            performer: job.info.uploader
              ? job.info.uploader.slice(0, 100)
              : undefined,
            duration: job.info.duration || undefined,
            thumbnail: job.info.thumbnail
              ? new InputFile({ url: job.info.thumbnail })
              : undefined,
          }),
        () =>
          bot.api.sendAudio(chatId, new InputFile(filePath, audioName), {
            caption,
            parse_mode: "HTML",
            title: job.info.title.slice(0, 100),
            performer: job.info.uploader
              ? job.info.uploader.slice(0, 100)
              : undefined,
            duration: job.info.duration || undefined,
          }),
        () =>
          bot.api.sendDocument(chatId, new InputFile(filePath, audioName), {
            caption,
            parse_mode: "HTML",
          }),
      ]
    : isImage
      ? [
          () =>
            bot.api.sendPhoto(chatId, new InputFile(filePath), {
              caption,
              parse_mode: "HTML",
            }),
          () =>
            bot.api.sendDocument(chatId, new InputFile(filePath), {
              caption,
              parse_mode: "HTML",
            }),
        ]
      : [
          () =>
            bot.api.sendVideo(chatId, new InputFile(filePath, videoName), {
              caption,
              parse_mode: "HTML",
              supports_streaming: true,
            }),
          () =>
            bot.api.sendDocument(chatId, new InputFile(filePath), {
              caption,
              parse_mode: "HTML",
            }),
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

export async function handleJobResult(
  bot: Bot,
  chatId: number,
  job: DownloadJob,
  result: Awaited<DownloadJob["promise"]>,
): Promise<void> {
  const statusId = job.statusMessageId;
  const finish = async (text: string) => {
    if (statusId) {
      await bot.api
        .editMessageText(chatId, statusId, text)
        .catch(() => bot.api.sendMessage(chatId, text));
    } else {
      await bot.api.sendMessage(chatId, text);
    }
  };

  if (result.ok) {
    try {
      await uploadAndSend(
        bot,
        chatId,
        job,
        result.path,
        result.size,
        result.paths,
      );
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
