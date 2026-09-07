import { ExtractError, type VideoInfo } from "../services/extractor.js";
import type { PlatformConfig } from "./types.js";

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#064;/g, "@");
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
        throw new ExtractError(
          "Post Instagram tidak ditemukan atau privat.",
          "unavailable",
        );
      }
      throw new ExtractError(
        `Gagal mengambil konten Instagram (HTTP ${res.status}).`,
        "error",
      );
    }

    pageHtml = await res.text();
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    throw new ExtractError("Gagal terhubung ke Instagram.", "error");
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

  // Find images
  const imgs = pageHtml.matchAll(
    /<img[^>]+src=[\x22\x27]([^\x22\x27]+)[\x22\x27]/g,
  );
  const cleanImages: string[] = [];
  const seen = new Set<string>();

  for (const match of imgs) {
    const rawSrc = decodeHtmlEntities(match[1]);
    if (rawSrc.includes("s100x100") || rawSrc.includes("rsrc.php")) continue;
    const idMatch = rawSrc.match(/\/(\d+_\d+_\d+_n\.jpg)/);
    if (idMatch) {
      const fileId = idMatch[1];
      if (!seen.has(fileId)) {
        seen.add(fileId);
        cleanImages.push(rawSrc);
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

  throw new ExtractError(
    "Tidak ditemukan foto atau video yang dapat diunduh pada postingan ini.",
    "unavailable",
  );
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
