import { InlineKeyboard } from "grammy";
import { config } from "../config.js";
import { PLATFORM_LABEL, type Platform } from "../platforms/index.js";
import {
  availableHeights,
  estimateAudioSize,
  estimateVideoSize,
  formatBytes,
  formatDuration,
  type VideoInfo,
} from "../services/index.js";
import { esc, newToken, pending } from "./utils.js";

export function buildImagePreview(
  info: VideoInfo,
  platform: Platform,
  userId: number
): { caption: string; keyboard: InlineKeyboard } {
  const token = newToken();
  pending.set(token, {
    info,
    platform,
    userId,
    expires: Date.now() + config.previewTtlMin * 60_000,
  });

  const keyboard = new InlineKeyboard().text("📷 Unduh Gambar", `dl:${token}:i`);
  const caption = [
    `📌 <b>${esc(info.title.slice(0, 150))}</b>`,
    `Platform: ${PLATFORM_LABEL[platform]}${info.uploader ? ` • ${esc(info.uploader.slice(0, 60))}` : ""}`,
    "",
    "Konten ini berupa gambar/foto.",
  ].join("\n");

  return { caption, keyboard };
}

export function buildVideoPreview(
  info: VideoInfo,
  platform: Platform,
  userId: number
): { caption: string; keyboard: InlineKeyboard } {
  const token = newToken();
  pending.set(token, {
    info,
    platform,
    userId,
    expires: Date.now() + config.previewTtlMin * 60_000,
  });

  const keyboard = new InlineKeyboard();
  const lines: string[] = [];
  lines.push(`📌 <b>${esc(info.title.slice(0, 150))}</b>`);
  lines.push(
    `Platform: ${PLATFORM_LABEL[platform]}${info.uploader ? ` • ${esc(info.uploader.slice(0, 60))}` : ""}`
  );
  lines.push(`Durasi: ${info.isLive ? "🔴 LIVE" : formatDuration(info.duration)}`);
  lines.push("");
  lines.push("Pilih format:");

  const heights = availableHeights(info);
  for (const h of heights.slice(0, 5)) {
    const size = estimateVideoSize(info, h);
    const label = `🎥 MP4 ${h}p${size ? ` • ~${formatBytes(size)}` : ""}`;
    keyboard.text(
      label.length > 56 ? `🎥 ${h}p${size ? ` • ~${formatBytes(size)}` : ""}` : label,
      `dl:${token}:v${h}`
    ).row();
  }

  const audioSize = estimateAudioSize(info);
  keyboard.text(
    `🎵 MP3 Audio${audioSize ? ` • ~${formatBytes(audioSize)}` : ""}`,
    `dl:${token}:a`
  ).row();

  return { caption: lines.join("\n"), keyboard };
}
