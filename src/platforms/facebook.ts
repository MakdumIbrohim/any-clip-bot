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

export async function fetchFacebookPhotoInfo(url: string): Promise<VideoInfo | null> {
  let html = "";
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok && res.status !== 400) return null;
    html = await res.text();
  } catch {
    return null;
  }

  const imgRegex = /https:\/\/[^"'\s]+\.(?:jpg|jpeg|png|webp)[^"'\s]*/g;
  const matches = html.match(imgRegex) ?? [];
  const validImages: string[] = [];
  const seen = new Set<string>();

  for (const raw of matches) {
    const cleanUrl = decodeHtmlEntities(raw);
    if (!cleanUrl.includes("fbcdn.net")) continue;
    if (cleanUrl.includes("rsrc.php") || cleanUrl.includes("s100x100")) continue;
    // Extract base id if possible or clean path
    const urlObj = new URL(cleanUrl);
    const pathname = urlObj.pathname;
    if (!seen.has(pathname)) {
      seen.add(pathname);
      validImages.push(cleanUrl);
    }
  }

  if (validImages.length === 0) return null;

  let title = "Foto Facebook";
  const descMatch = html.match(/<meta property=["']og:description["'] content=["']([^"']+)["']/i);
  if (descMatch) {
    title = decodeHtmlEntities(descMatch[1]).trim();
  } else {
    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch) {
      title = decodeHtmlEntities(titleMatch[1]).replace(/ \| Facebook$/i, "").trim();
    }
  }

  let uploader: string | null = null;
  const ogTitleMatch = html.match(/<meta property=["']og:title["'] content=["']([^"']+)["']/i);
  if (ogTitleMatch) {
    uploader = decodeHtmlEntities(ogTitleMatch[1]).trim();
  }

  const idMatch = url.match(/\/p\/([a-zA-Z0-9_-]+)/) || url.match(/story_fbid=(\d+)/);
  const id = idMatch ? idMatch[1] : "fb_photo";

  return {
    id,
    title,
    duration: 0,
    thumbnail: validImages[0],
    uploader,
    webpageUrl: validImages[0],
    platform: "facebook",
    formats: [],
    isLive: false,
    availability: null,
    isImage: true,
    images: validImages,
  };
}

export const facebookPlatform: PlatformConfig = {
  id: "facebook",
  name: "Facebook",
  domains: ["facebook.com", "fb.com", "fb.watch"],
  hasVideoPath: (url, pathname) =>
    /\/(video|watch|reel|stories)\/|\/\d+\/(\d+)\/?|fb\.watch/i.test(pathname) ||
    /fb\.watch/i.test(url),
};
