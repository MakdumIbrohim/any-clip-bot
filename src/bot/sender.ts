import { Bot, InlineKeyboard, InputFile } from "grammy";
import { config } from "../config.js";
import { PLATFORM_LABEL } from "../platforms/index.js";
import {
  availableHeights,
  cleanupJobDir,
  formatBytes,
  type DownloadJob,
} from "../services/index.js";
import { sanitize } from "./utils.js";

export async function uploadAndSend(
  bot: Bot,
  chatId: number,
  job: DownloadJob,
  filePath: string,
  size: number,
  allPaths?: string[]
): Promise<void> {
  const isAudio = job.kind.type === "audio";
  const isImage = job.kind.type === "image";
  const emoji = isAudio ? "🎵" : isImage ? "📷" : "🎬";
  const imageIndex = job.kind.type === "image" ? job.kind.index : undefined;
  const slideLabel = imageIndex !== undefined ? ` [Foto ${imageIndex}]` : "";
  const caption = `${emoji} ${job.info.title.slice(0, 100)}${slideLabel}\n${PLATFORM_LABEL[job.platform]} • ${formatBytes(size)}`;

  // Multi-image album
  if (isImage && allPaths && allPaths.length > 1) {
    const CHUNK_SIZE = 10;
    for (let i = 0; i < allPaths.length; i += CHUNK_SIZE) {
      const chunk = allPaths.slice(i, i + CHUNK_SIZE);
      const media = chunk.map((p, idx) => ({
        type: "photo" as const,
        media: new InputFile(p),
        caption: i === 0 && idx === 0 ? caption : undefined,
      }));
      await bot.api.sendMediaGroup(chatId, media);
    }
    return;
  }

  const videoName = `${sanitize(job.info.title)}.mp4`;
  const audioName = `${sanitize(job.info.title)}.mp3`;
  const senders = isAudio
    ? [
        () => bot.api.sendAudio(chatId, new InputFile(filePath, audioName), { caption }),
        () => bot.api.sendDocument(chatId, new InputFile(filePath, audioName), { caption }),
      ]
    : isImage
      ? [
          () => bot.api.sendPhoto(chatId, new InputFile(filePath), { caption }),
          () => bot.api.sendDocument(chatId, new InputFile(filePath), { caption }),
        ]
      : [
          () =>
            bot.api.sendVideo(chatId, new InputFile(filePath, videoName), {
              caption,
              supports_streaming: true,
            }),
          () => bot.api.sendDocument(chatId, new InputFile(filePath), { caption }),
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
  result: Awaited<DownloadJob["promise"]>
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
      await uploadAndSend(bot, chatId, job, result.path, result.size, result.paths);
      await (statusId
        ? bot.api.deleteMessage(chatId, statusId).catch(() => {})
        : Promise.resolve());
    } catch (err) {
      await finish(`❌ Gagal mengirim file: ${(err as Error).message.slice(0, 200)}`);
    } finally {
      cleanupJobDir(job);
    }
    return;
  }

  if (!result.ok && result.code === "too_big") {
    cleanupJobDir(job);
    const lower = availableHeights(job.info).filter(
      (h) => h < (job.kind.type === "video" ? job.kind.height : 1e9)
    );
    await finish(
      `❌ Ukuran file ${formatBytes(result.size)} melebihi batas kirim bot (${config.maxUploadMb} MB).` +
        (lower.length
          ? `\nCoba resolusi lebih rendah: ${lower.slice(0, 3).join("p / ")}p, atau pilih MP3.`
          : "\nPilih format MP3 saja sebagai alternatif.")
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
    `❌ ${(result.code === "error" ? result.message : "Kesalahan tidak diketahui.").slice(0, 300)}`
  );
}
