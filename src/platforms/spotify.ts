import { ExtractError, type VideoInfo } from "../services/extractor.js";
import type { DownloadJob } from "../services/queue.js";
import type { PlatformConfig } from "./types.js";
import path from "node:path";
import { config } from "../config.js";

interface SpotifyTrackEntity {
  name: string;
  artists?: Array<{ name: string }>;
  duration?: number;
  visualIdentity?: {
    image?: Array<{ url: string; maxHeight?: number; maxWidth?: number }>;
  };
}

async function fetchLyrics(
  artist: string | null,
  title: string,
): Promise<string | null> {
  try {
    const cleanTitle = title
      .replace(/\s*\(.*?\)\s*/g, " ")
      .replace(/\s*-\s*.*$/g, " ")
      .trim();
    const query = new URLSearchParams();
    if (artist) query.set("artist_name", artist.split(",")[0].trim());
    query.set("track_name", cleanTitle);

    const res = await fetch(`https://lrclib.net/api/get?${query.toString()}`, {
      headers: { "User-Agent": "SnapSaveKitBot/1.0" },
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const data = await res.json();
      const lyrics = data.plainLyrics || data.syncedLyrics;
      if (lyrics && lyrics.length > 30) return lyrics;
    }

    // Coba pencarian luas jika direct get gagal
    const searchRes = await fetch(
      `https://lrclib.net/api/search?q=${encodeURIComponent(`${artist || ""} ${cleanTitle}`.trim())}`,
      {
        headers: { "User-Agent": "SnapSaveKitBot/1.0" },
        signal: AbortSignal.timeout(6000),
      },
    );
    if (searchRes.ok) {
      const results = await searchRes.json();
      if (Array.isArray(results)) {
        for (const r of results) {
          const l = r.plainLyrics || r.syncedLyrics;
          if (l && l.length > 30) return l;
        }
      }
    }
  } catch {
    /* ignore lyrics error */
  }
  return null;
}

export async function fetchSpotifyInfo(url: string): Promise<VideoInfo> {
  const cleanUrl = url.split("?")[0];
  const trackIdMatch = cleanUrl.match(/\/track\/([a-zA-Z0-9]+)/i);
  if (!trackIdMatch) {
    throw new ExtractError(
      "Link Spotify yang didukung saat ini adalah link track/lagu.",
      "unsupported",
    );
  }
  const trackId = trackIdMatch[1];
  const embedUrl = `https://open.spotify.com/embed/track/${trackId}`;

  let html = "";
  try {
    const res = await fetch(embedUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      if (res.status === 404) {
        throw new ExtractError("Lagu Spotify tidak ditemukan.", "unavailable");
      }
      throw new ExtractError(
        `Gagal mengambil data Spotify (HTTP ${res.status}).`,
        "error",
      );
    }
    html = await res.text();
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError("Gagal terhubung ke Spotify.", "error");
  }

  let title = "Spotify Track";
  let uploader: string | null = null;
  let duration = 0;
  let thumbnail: string | null = null;
  let album: string | null = null;

  const nextDataMatch = html.match(
    /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s,
  );
  if (nextDataMatch) {
    try {
      const data = JSON.parse(nextDataMatch[1]);
      const entity: SpotifyTrackEntity | undefined =
        data?.props?.pageProps?.state?.data?.entity;
      if (entity) {
        title = entity.name || title;
        if (entity.artists && entity.artists.length > 0) {
          uploader = entity.artists.map((a) => a.name).join(", ");
        }
        if (entity.duration) {
          duration = Math.round(entity.duration / 1000);
        }
        const images = entity.visualIdentity?.image ?? [];
        if (images.length > 0) {
          const sorted = [...images].sort(
            (a, b) => (b.maxWidth ?? 0) - (a.maxWidth ?? 0),
          );
          thumbnail = sorted[0].url;
        }
      }
    } catch {
      /* fallback */
    }
  }

  // Ambil metadata album dari halaman web biasa jika belum ada
  try {
    const pageRes = await fetch(`https://open.spotify.com/track/${trackId}`, {
      headers: {
        "User-Agent":
          "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(8000),
    });
    if (pageRes.ok) {
      const pageHtml = await pageRes.text();
      // Pola meta og:description: "Artist · Album · Song · Year"
      const ogDescMatch = pageHtml.match(
        /<meta property=["']og:description["'] content=["']([^"']+)["']/i,
      );
      if (ogDescMatch) {
        const parts = ogDescMatch[1].split("·").map((s) => s.trim());
        if (parts.length >= 2 && parts[1] !== "Single" && parts[1] !== "Song") {
          album = parts[1];
        }
      }

      if (!album) {
        const scriptMatches = pageHtml.matchAll(
          /<script[^>]*>(.*?)<\/script>/gs,
        );
        for (const m of scriptMatches) {
          const text = m[1].trim();
          if (text.startsWith("ey")) {
            try {
              const decoded = Buffer.from(text, "base64").toString("utf-8");
              const d = JSON.parse(decoded);
              const item = d?.entities?.items?.[`spotify:track:${trackId}`];
              if (item) {
                if (item.albumOfTrack?.name) album = item.albumOfTrack.name;
                else if (item.album?.name) album = item.album.name;
                break;
              }
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
  } catch {
    /* ignore page fetch */
  }

  // Fallback oEmbed jika judul atau thumbnail belum didapat
  if (!thumbnail || title === "Spotify Track") {
    try {
      const oembedRes = await fetch(
        `https://open.spotify.com/oembed?url=${encodeURIComponent(cleanUrl)}`,
      );
      if (oembedRes.ok) {
        const odata = await oembedRes.json();
        if (odata.title) title = odata.title;
        if (odata.thumbnail_url) thumbnail = odata.thumbnail_url;
      }
    } catch {
      /* ignore */
    }
  }

  // Fallback metadata album / cover art via iTunes Search jika Spotify tidak menyediakan (misal region lock)
  if (!album || !thumbnail) {
    try {
      const itunesQuery = uploader ? `${uploader} ${title}` : title;
      const itunesRes = await fetch(
        `https://itunes.apple.com/search?term=${encodeURIComponent(itunesQuery)}&entity=song&limit=1`,
        { signal: AbortSignal.timeout(5000) }
      );
      if (itunesRes.ok) {
        const itunesData = await itunesRes.json();
        const item = itunesData.results?.[0];
        if (item) {
          if (!album && item.collectionName) album = item.collectionName;
          if (!thumbnail && item.artworkUrl100) {
            thumbnail = item.artworkUrl100.replace("100x100bb", "600x600bb");
          }
        }
      }
    } catch {
      /* ignore itunes search */
    }
  }

  // Ambil lirik secara paralel / async
  const lyrics = await fetchLyrics(uploader, title);

  const query = uploader ? `${uploader} - ${title}` : title;

  return {
    id: trackId,
    title,
    duration,
    thumbnail,
    uploader,
    album,
    lyrics,
    webpageUrl: url,
    platform: "spotify",
    formats: [
      {
        formatId: "audio_only",
        ext: "mp3",
        resolution: "audio",
        height: null,
        fps: null,
        vcodec: "none",
        acodec: "mp3",
        filesize: null,
        tbr: 128,
        source: `ytsearch1:${query} audio`,
      },
    ],
    isLive: false,
    availability: null,
    isImage: false,
  };
}

export const spotifyPlatform: PlatformConfig = {
  id: "spotify",
  name: "Spotify",
  domains: ["spotify.com", "open.spotify.com"],
  hasVideoPath: (_url, pathname) => /\/track\/[a-zA-Z0-9]+/i.test(pathname),
  fetchInfo: fetchSpotifyInfo,
  buildDownloadArgs: (job: DownloadJob, dir: string) => {
    const query = job.info.uploader
      ? `${job.info.uploader} - ${job.info.title}`
      : job.info.title;
    const searchTarget = `ytsearch1:${query} audio`;
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
      "-x",
      "--audio-format",
      "mp3",
      "--audio-quality",
      "0",
    ];

    if (path.isAbsolute(config.bin.ffmpeg)) {
      args.push("--ffmpeg-location", config.bin.ffmpeg);
    }

    args.push(searchTarget);
    return args;
  },
};
