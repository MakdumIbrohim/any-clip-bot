import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import type { VideoInfo } from "./extractor.js";
import { getPlatformConfig } from "./platforms/index.js";
import type { DownloadJob, JobResult } from "./queue.js";

export function availableHeights(info: VideoInfo): number[] {
  const set = new Set<number>();
  for (const f of info.formats) {
    if (f.vcodec !== "none" && f.height && f.height <= config.maxResolution)
      set.add(f.height);
  }
  return [...set].sort((a, b) => b - a);
}

function bytesForBitrate(kbps: number, duration: number): number {
  return Math.round((kbps * 1000 * duration) / 8);
}

export function estimateVideoSize(
  info: VideoInfo,
  height: number,
): number | null {
  if (!info.duration) return null;
  const video = info.formats
    .filter((f) => f.vcodec !== "none" && f.height === height)
    .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
  if (!video) return null;
  let bytes =
    video.filesize ??
    (video.tbr ? bytesForBitrate(video.tbr, info.duration) : 0);
  if (video.acodec === "none") {
    const audio = info.formats
      .filter((f) => f.vcodec === "none" && f.acodec !== "none")
      .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
    bytes +=
      audio?.filesize ??
      (audio?.tbr ? bytesForBitrate(audio.tbr, info.duration) : 128_000);
  }
  return bytes > 0 ? bytes : null;
}

export function estimateAudioSize(info: VideoInfo): number | null {
  if (!info.duration) return null;
  const audio = info.formats
    .filter((f) => f.vcodec === "none" && f.acodec !== "none")
    .sort((a, b) => (b.tbr ?? 0) - (a.tbr ?? 0))[0];
  const fromSource =
    audio?.filesize ??
    (audio?.tbr ? bytesForBitrate(audio.tbr, info.duration) : null);
  const mp3Default = bytesForBitrate(160, info.duration);
  return fromSource ? Math.min(fromSource, mp3Default) : mp3Default;
}

export function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`;
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

export function formatDuration(sec: number): string {
  if (!sec) return "-";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return h
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function jobOutputDir(job: DownloadJob): string {
  return path.join(config.tmpDir, job.id);
}

const MEDIA_EXT = new Set([
  "mp4",
  "mkv",
  "webm",
  "mp3",
  "m4a",
  "opus",
  "wav",
  "mov",
  "jpg",
  "jpeg",
  "png",
  "webp",
  "gif",
]);

function findOutputFile(dir: string): string | null {
  const files = fs
    .readdirSync(dir)
    .map((f) => path.join(dir, f))
    .filter((f) => MEDIA_EXT.has(path.extname(f).slice(1).toLowerCase()))
    .map((f) => ({ f, size: fs.statSync(f).size }))
    .filter((x) => x.size > 0)
    .sort((a, b) => b.size - a.size);
  return files[0]?.f ?? null;
}

function buildArgs(job: DownloadJob, dir: string): string[] {
  const handler = getPlatformConfig(job.platform);
  if (handler?.buildDownloadArgs) {
    const customArgs = handler.buildDownloadArgs(job, dir);
    if (customArgs) return customArgs;
  }

  const out = path.join(dir, "%(id)s.%(ext)s");
  const args = [
    "--no-playlist",
    "--no-warnings",
    "--newline",
    "--progress",
    "--no-part",
    "--restrict-filenames",
    "-o",
    out,
  ];
  if (path.isAbsolute(config.bin.ffmpeg)) {
    args.push("--ffmpeg-location", config.bin.ffmpeg);
  }
  if (config.youTubeCookies && job.platform === "youtube") {
    args.push("--cookies", config.youTubeCookies);
  }
  if (job.kind.type === "audio") {
    args.push("-x", "--audio-format", "mp3", "--audio-quality", "5");
  } else if (job.kind.type === "image") {
    args.push("-f", "Image");
  } else {
    const h = job.kind.height;
    args.push(
      "-f",
      `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]`,
      "--merge-output-format",
      "mp4",
    );
  }
  args.push(job.info.webpageUrl || job.info.id);
  return args;
}

export async function runDownload(
  job: DownloadJob,
  report: (percent: number | null, stage: string) => void,
): Promise<JobResult> {
  const dir = jobOutputDir(job);
  fs.mkdirSync(dir, { recursive: true });

  report(null, "Mengunduh…");
  const started = Date.now();

  const code = await new Promise<number>((resolve, reject) => {
    const child = spawn(config.bin.ytDlp, buildArgs(job, dir), {
      stdio: ["ignore", "pipe", "pipe"],
    });
    job.child = child;
    let stderrBuf = "";
    const hardTimeout = setTimeout(
      () => child.kill("SIGKILL"),
      config.queueTimeoutSec * 1000,
    );

    child.stdout.on("data", (buf: Buffer) => {
      for (const line of buf.toString().split("\n")) {
        const pct = line.match(/\[download\]\s+([\d.]+)%/);
        if (pct) {
          report(Number(pct[1]), "Mengunduh…");
          continue;
        }
        if (/\[ExtractAudio\]|\[FFmpegVideoConvertor\]/.test(line))
          report(null, "Mengonversi…");
        else if (/\[Merger\]|\[FixupM4a\]|\[FixupVerb\]/.test(line))
          report(null, "Menggabungkan audio/video…");
        else if (/\[download\] Finished/.test(line))
          report(100, "Mengonversi…");
      }
    });
    child.stderr.on("data", (buf: Buffer) => {
      stderrBuf += buf.toString();
      if (stderrBuf.length > 8000) stderrBuf = stderrBuf.slice(-4000);
    });
    child.on("error", (err) => {
      clearTimeout(hardTimeout);
      reject(err);
    });
    child.on("close", (c) => {
      clearTimeout(hardTimeout);
      if (job.cancelled) return resolve(-1);
      if (c === 0) return resolve(0);
      const msg =
        stderrBuf.match(/ERROR:\s*(.+)/)?.[1] ?? "proses unduhan gagal";
      reject(new Error(msg));
    });
  });

  if (code === -1 || job.cancelled) {
    return { ok: false, code: "cancelled" };
  }

  const file = findOutputFile(dir);
  if (!file) throw new Error("File hasil unduhan tidak ditemukan.");

  report(null, "Mengirim…");
  const size = fs.statSync(file).size;
  if (size > config.maxUploadMb * 1024 * 1024) {
    return { ok: false, code: "too_big", size, path: file };
  }
  return { ok: true, path: file, size, ms: Date.now() - started };
}

export function cleanupJobDir(job: DownloadJob): void {
  fs.rmSync(jobOutputDir(job), { recursive: true, force: true });
}

export function sweepStaleTmp(): void {
  if (!fs.existsSync(config.tmpDir)) return;
  const maxAge = config.queueTimeoutSec * 2000;
  for (const entry of fs.readdirSync(config.tmpDir)) {
    const p = path.join(config.tmpDir, entry);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs > maxAge)
        fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
