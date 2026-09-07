import type { PlatformConfig } from "./types.js";
import type { VideoInfo } from "../services/extractor.js";
export class InstagramExtractError extends Error {
  constructor(
    message: string,
    readonly code: "invalid_url" | "unavailable" | "private" | "region" | "age" | "unsupported" | "timeout" | "error" = "error"
  ) {
    super(message);
  }
}

export const instagramPlatform: PlatformConfig = {
  id: "instagram",
  name: "Instagram",
  domains: ["instagram.com", "instagr.am"],
  hasVideoPath: (_url, pathname) =>
    /\/(p|reel|reels|tv)\/[\w-]+/i.test(pathname),
  buildDownloadArgs: (job, dir) => {
    if (job.kind.type === "image") {
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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#064;/g, "@");
}

function boostInstagramImageUrl(rawUrl: string): string {
  let url = rawUrl;
  // Ubah batas resolusi thumbnail/preview (s320x320, s640x640, dll.) ke ukuran maksimal (s1080x1080)
  url = url.replace(/s\d+x\d+/g, "s1080x1080");
  // Hapus parameter crop Instagram seperti c0.134.1080.1080a_
  url = url.replace(/c\d+\.\d+\.\d+\.\d+a_/g, "");
  // Hapus path segment /s150x150/ dsb jika ada
  url = url.replace(/\/s\d+x\d+\//g, "/");
  return url;
}

export async function fetchInstagramEmbedInfo(url: string): Promise<VideoInfo> {
  const cleanUrl = url.split("?")[0].replace(/\/+$/, "");
  const parts = cleanUrl.split("/");
  const postId = parts[parts.length - 1] || "instagram_post";
  const embedUrl = `${cleanUrl}/embed/captioned/`;

  let pageHtml = "";
  try {
    const res = await fetch(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
      },
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) {
      if (res.status === 404) {
        throw new InstagramExtractError(
          "Post Instagram tidak ditemukan atau privat.",
          "unavailable",
        );
      }
      throw new InstagramExtractError(
        `Gagal mengambil konten Instagram (HTTP ${res.status}).`,
        "error",
      );
    }

    pageHtml = await res.text();
  } catch (err) {
    if (err instanceof InstagramExtractError) throw err;
    throw new InstagramExtractError("Gagal terhubung ke Instagram.", "error");
  }

  // Caption
  const captionMatch = pageHtml.match(
    /class=[\x22\x27]Caption[\x22\x27][^>]*>(.*?)<\/div>/s,
  );
  let title = "Post Instagram";
  if (captionMatch) {
    title = decodeHtmlEntities(captionMatch[1].replace(/<[^>]+>/g, "").trim());
  }

  // Uploader
  const authorMatch = pageHtml.match(
    /class=[\x22\x27]UsernameText[\x22\x27][^>]*>(.*?)<\/div>/s,
  );
  let uploader: string | null = null;
  if (authorMatch) {
    uploader = decodeHtmlEntities(
      authorMatch[1]
        .replace(/<[^>]+>/g, "")
        .replace(/\d+[KM]?\s+followers.*/i, "")
        .trim(),
    );
  }

  // 1. Ekstrak gambar HD dari display_url internal embed
  const cleanImages: string[] = [];
  const seen = new Set<string>();

  let searchIdx = 0;
  while (true) {
    searchIdx = pageHtml.indexOf("display_url", searchIdx);
    if (searchIdx === -1) break;
    const start = pageHtml.indexOf("https:", searchIdx);
    const end = pageHtml.indexOf('"', start);
    if (start !== -1 && end !== -1) {
      const raw = pageHtml.slice(start, end);
      const clean = raw
        .replaceAll("\\\\\\/", "/")
        .replaceAll("\\\\/", "/")
        .replaceAll("\\/", "/")
        .replaceAll("\\u0026", "&")
        .replaceAll("\\u00253D", "%3D")
        .replace(/\\+/g, "");

      const idMatch = clean.match(/\/(\d+_\d+_\d+_n\.jpg)/);
      const fileId = idMatch ? idMatch[1] : clean.split("?")[0];
      if (!seen.has(fileId)) {
        seen.add(fileId);
        cleanImages.push(clean);
      }
    }
    searchIdx += 11;
  }

  // 2. Fallback: Parse tag <img> jika display_url tidak ditemukan
  if (cleanImages.length === 0) {
    const imgs = pageHtml.matchAll(
      /<img[^>]+src=[\x22\x27]([^\x22\x27]+)[\x22\x27]/g,
    );

    for (const match of imgs) {
      const rawSrc = decodeHtmlEntities(match[1]);
      if (rawSrc.includes("s100x100") || rawSrc.includes("rsrc.php")) continue;
      const idMatch = rawSrc.match(/\/(\d+_\d+_\d+_n\.jpg)/);
      if (idMatch) {
        const fileId = idMatch[1];
        if (!seen.has(fileId)) {
          seen.add(fileId);
          cleanImages.push(boostInstagramImageUrl(rawSrc));
        }
      }
    }
  }

  if (cleanImages.length > 0) {
    return {
      id: postId,
      title: title || "Foto Instagram",
      duration: 0,
      thumbnail: cleanImages[0],
      uploader,
      webpageUrl: cleanImages[0],
      platform: "instagram",
      formats: [],
      isLive: false,
      availability: null,
      isImage: true,
      images: cleanImages,
    };
  }

  throw new InstagramExtractError(
    "Tidak ditemukan foto atau video yang dapat diunduh pada postingan ini.",
    "unavailable",
  );
}
