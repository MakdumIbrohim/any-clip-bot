import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "./config.js";
import type { Platform } from "./detect.js";

const pexecFile = promisify(execFile);

export type VideoFormat = {
  formatId: string;
  ext: string;
  resolution: string;
  height: number | null;
  fps: number | null;
  vcodec: string;
  acodec: string;
  filesize: number | null;
  tbr: number | null;
  source: string;
};

export type VideoInfo = {
  id: string;
  title: string;
  duration: number;
  thumbnail: string | null;
  uploader: string | null;
  webpageUrl: string;
  platform: Platform;
  formats: VideoFormat[];
  isLive: boolean;
  availability: string | null;
};

export class ExtractError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_url"
      | "unavailable"
      | "private"
      | "region"
      | "age"
      | "unsupported"
      | "timeout"
      | "error" = "error"
  ) {
    super(message);
  }
}

function classifyError(stderr: string): ExtractError {
  const s = stderr.toLowerCase();
  if (/private video|members-only|log in to confirm|account needs/.test(s))
    return new ExtractError("Konten ini privat atau butuh login. Tidak bisa diunduh.", "private");
  if (/age[- ]restricted|confirm your age/.test(s))
    return new ExtractError("Konten dibatasi usia. Tidak bisa diunduh.", "age");
  if (/not available in your country|geo|region/.test(s))
    return new ExtractError("Konten dibatasi wilayah (region-locked).", "region");
  if (/video unavailable|has been removed|does not exist|404|not found/.test(s))
    return new ExtractError("Video tidak tersedia (dihapus atau link salah).", "unavailable");
  if (/is not a valid url|unsupported url|no usable/.test(s))
    return new ExtractError("Link tidak dikenali / tidak valid.", "invalid_url");
  if (/timed? ?out/.test(s))
    return new ExtractError("Waktu proses sumber habis. Coba lagi sebentar.", "timeout");
  return new ExtractError("Gagal mengambil info dari platform. Mungkin struktur berubah.", "error");
}

async function runYtDlp(args: string[], timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await pexecFile(config.bin.ytDlp, args, {
      maxBuffer: 32 * 1024 * 1024,
      timeout: timeoutMs,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; killed?: boolean; code?: number };
    if (e.killed || e.code === undefined && "signal" in e) throw new ExtractError("Waktu proses sumber habis.", "timeout");
    throw classifyError(e.stderr ?? String(err));
  }
}

const INFO_TIMEOUT_MS = 60_000;

export async function fetchInfo(url: string, platform: Platform): Promise<VideoInfo> {
  const args = ["-J", "--no-playlist", "--no-warnings", "--no-progress"];
  if (config.youTubeCookies && platform === "youtube") {
    args.push("--cookies", config.youTubeCookies);
  }
  args.push(url);

  const raw = await runYtDlp(args, INFO_TIMEOUT_MS);
  const data = JSON.parse(raw);

  if (data.playlist_count != null || data._type === "playlist") {
    throw new ExtractError("Link playlist tidak didukung. Kirim link satu video saja.", "unsupported");
  }

  const formats: VideoFormat[] = (data.formats ?? [])
    .filter((f: any) => f.vcodec !== "none" || f.acodec !== "none")
    .map((f: any) => ({
      formatId: String(f.format_id),
      ext: f.ext ?? "",
      resolution: f.resolution ?? (f.height ? `${f.height}p` : "audio"),
      height: f.height ?? null,
      fps: f.fps ?? null,
      vcodec: f.vcodec ?? "none",
      acodec: f.acodec ?? "none",
      filesize: f.filesize ?? f.filesize_approx ?? null,
      tbr: f.tbr ?? null,
      source: f.source ?? "",
    }));

  return {
    id: String(data.id ?? ""),
    title: data.title ?? "Tanpa judul",
    duration: data.duration ?? 0,
    thumbnail: data.thumbnail ?? null,
    uploader: data.uploader ?? data.channel ?? data.artist ?? null,
    webpageUrl: data.webpage_url ?? url,
    platform,
    formats,
    isLive: !!data.is_live,
    availability: data.availability ?? null,
  };
}
