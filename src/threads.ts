import type { VideoFormat, VideoInfo } from "./extractor.js";
import { ExtractError } from "./extractor.js";

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#064;/g, "@");
}

function extractMeta(html: string, property: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:property|name)=[\\x22\\x27]${property}[\\x22\\x27][^>]+content=[\\x22\\x27]([^\\x22\\x27]+)[\\x22\\x27]`, "i");
  const match = html.match(re);
  return match ? decodeHtmlEntities(match[1]) : null;
}

export async function fetchThreadsInfo(url: string): Promise<VideoInfo> {
  const cleanUrl = url.split("?")[0].replace(/\/+$/, "");
  const parts = cleanUrl.split("/");
  const postId = parts[parts.length - 1] || "threads_post";
  const embedUrl = `${cleanUrl}/embed`;

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
        throw new ExtractError("Post Threads tidak ditemukan atau sudah dihapus.", "unavailable");
      }
      throw new ExtractError(`Gagal mengambil konten Threads (HTTP ${res.status}).`, "error");
    }

    pageHtml = await res.text();
  } catch (err) {
    if (err instanceof ExtractError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    if (/timeout|abort/i.test(msg)) {
      throw new ExtractError("Waktu proses Threads habis. Coba lagi.", "timeout");
    }
    throw new ExtractError("Gagal terhubung ke Threads.", "error");
  }

  // Extract author
  const authorMatch = pageHtml.match(/class=[\x22\x27]AuthorIdentity[\x22\x27].*?class=[\x22\x27]HeaderLink[\x22\x27]><span>(.*?)<\/span>/s);
  let uploader = authorMatch ? decodeHtmlEntities(authorMatch[1].trim()) : null;
  if (!uploader) {
    const usernameFromUrl = parts.find((p) => p.startsWith("@"));
    if (usernameFromUrl) uploader = usernameFromUrl.slice(1);
  }

  // Extract caption / title
  const textMatch = pageHtml.match(/class=[\x22\x27]BodyTextContainer[\x22\x27]><span>(.*?)<\/span>/s);
  let title = textMatch ? decodeHtmlEntities(textMatch[1].trim()) : "";
  if (!title) {
    title = extractMeta(pageHtml, "og:description") ?? extractMeta(pageHtml, "description") ?? "Post Threads";
  }

  // Extract video source
  const videoMatch = pageHtml.match(/<video[^>]*>.*?<source[^>]*src=[\x22\x27]([^\x22\x27]+)[\x22\x27]/s);
  const videoUrl = videoMatch ? decodeHtmlEntities(videoMatch[1]) : null;

  // Extract image source
  const imgMatches = [...pageHtml.matchAll(/class=[\x22\x27]SingleInnerMediaContainer[^\x22\x27]*[\x22\x27][^>]*>.*?<img[^>]+src=[\x22\x27]([^\x22\x27]+)[\x22\x27]/gs)];
  const imageUrl = imgMatches.length > 0 ? decodeHtmlEntities(imgMatches[0][1]) : null;

  // Thumbnail
  let thumbnail = imageUrl;
  if (!thumbnail) {
    const avatarMatch = pageHtml.match(/class=[\x22\x27]AvatarContainer[\x22\x27].*?<img[^>]+src=[\x22\x27]([^\x22\x27]+)[\x22\x27]/s);
    if (avatarMatch) {
      thumbnail = decodeHtmlEntities(avatarMatch[1]);
    }
  }

  if (videoUrl) {
    let height: number | null = null;
    let filesize: number | null = null;

    try {
      const parsedUrl = new URL(videoUrl);
      const efg = parsedUrl.searchParams.get("efg");
      if (efg) {
        const decoded = Buffer.from(efg, "base64").toString("utf-8");
        const heightMatch = decoded.match(/C3\.(\d+)\./);
        if (heightMatch) height = Number(heightMatch[1]);
      }
    } catch {
      /* ignore efg parse */
    }

    try {
      const headRes = await fetch(videoUrl, {
        method: "HEAD",
        headers: { "User-Agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(5000),
      });
      const cl = headRes.headers.get("content-length");
      if (cl) filesize = Number(cl);
    } catch {
      /* ignore head error */
    }

    const format: VideoFormat = {
      formatId: "threads_video",
      ext: "mp4",
      resolution: height ? `${height}p` : "video",
      height,
      fps: null,
      vcodec: "h264",
      acodec: "aac",
      filesize,
      tbr: null,
      source: "threads",
    };

    return {
      id: postId,
      title,
      duration: 0,
      thumbnail,
      uploader,
      webpageUrl: videoUrl,
      platform: "threads",
      formats: [format],
      isLive: false,
      availability: null,
      isImage: false,
    };
  }

  if (imageUrl) {
    return {
      id: postId,
      title,
      duration: 0,
      thumbnail: imageUrl,
      uploader,
      webpageUrl: imageUrl,
      platform: "threads",
      formats: [],
      isLive: false,
      availability: null,
      isImage: true,
    };
  }

  throw new ExtractError("Tidak ditemukan media video atau gambar pada post Threads ini.", "unavailable");
}
