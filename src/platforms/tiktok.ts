import { ExtractError, type VideoInfo } from "../services/extractor.js";
import type { PlatformConfig } from "./types.js";

interface TikWmResponse {
  code: number;
  msg: string;
  data?: {
    id: string;
    title?: string;
    cover?: string;
    origin_cover?: string;
    images?: string[];
    author?: {
      unique_id?: string;
      nickname?: string;
      avatar?: string;
    };
    music?: string;
    play?: string;
  };
}

export async function fetchTikTokInfo(url: string): Promise<VideoInfo> {
  const isPhoto =
    /\/photo\//i.test(url) || /vt\.tiktok\.com|vm\.tiktok\.com/i.test(url);

  // Coba TikWM API
  try {
    const apiUrl = `https://tikwm.com/api/?url=${encodeURIComponent(url)}`;
    const res = await fetch(apiUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(15_000),
    });

    if (res.ok) {
      const json = (await res.json()) as TikWmResponse;
      if (json.code === 0 && json.data) {
        const d = json.data;
        const images = d.images ?? [];
        const isImage = images.length > 0;
        const mainMediaUrl = isImage ? images[0] : d.play || url;

        return {
          id: d.id || "tiktok_post",
          title: d.title?.trim() || "TikTok Post",
          duration: 0,
          thumbnail:
            d.cover || d.origin_cover || (images.length > 0 ? images[0] : null),
          uploader: d.author?.unique_id || d.author?.nickname || null,
          webpageUrl: mainMediaUrl,
          platform: "tiktok",
          formats: isImage
            ? []
            : [
                {
                  formatId: "tiktok_video",
                  ext: "mp4",
                  resolution: "HD",
                  height: null,
                  fps: null,
                  vcodec: "h264",
                  acodec: "aac",
                  filesize: null,
                  tbr: null,
                  source: "tiktok",
                },
              ],
          isLive: false,
          availability: null,
          isImage,
          images: isImage ? images : undefined,
        };
      }
    }
  } catch (err) {
    console.error("[tiktok] TikWM fallback error:", err);
  }

  // Jika bukan post foto, biarkan yt-dlp yang handle di layer atas
  if (!isPhoto) {
    throw new ExtractError("Gagal mengambil info video TikTok.", "error");
  }

  throw new ExtractError(
    "Gagal mengambil gambar dari postingan foto TikTok ini.",
    "unavailable",
  );
}

export const tiktokPlatform: PlatformConfig = {
  id: "tiktok",
  name: "TikTok",
  domains: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  hasVideoPath: (url, pathname) =>
    /\/(video|photo)\/\d+/i.test(pathname) || /^(\/)?(vm|vt)\./i.test(url),
  fetchInfo: async (url: string) => {
    // Jika link photo/shortlink, prioritaskan fetchTikTokInfo
    if (
      /\/photo\//i.test(url) ||
      /vt\.tiktok\.com|vm\.tiktok\.com/i.test(url)
    ) {
      try {
        return await fetchTikTokInfo(url);
      } catch (err) {
        // Fallback jika bukan photo atau fetchTikTokInfo gagal
        if (!(err instanceof ExtractError && err.code === "unavailable")) {
          throw err;
        }
      }
    }
    // undefined mengarahkan kembali ke yt-dlp di extractor.ts
    throw new ExtractError("USE_DEFAULT_YTDLP", "error");
  },
  buildDownloadArgs: (job, dir) => {
    if (job.kind.type === "image") {
      // yt-dlp direct image download
      const out = `${dir}/%(id)s.%(ext)s`;
      return [
        "--no-playlist",
        "--no-warnings",
        "--newline",
        "--progress",
        "--no-part",
        "--restrict-filenames",
        "-o",
        out,
        job.info.webpageUrl || job.info.id,
      ];
    }
    return null;
  },
};
