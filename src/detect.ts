export const SUPPORTED_PLATFORMS = [
  "youtube",
  "tiktok",
  "instagram",
  "facebook",
  "x",
  "threads",
] as const;

export type Platform = (typeof SUPPORTED_PLATFORMS)[number];

export const PLATFORM_LABEL: Record<Platform, string> = {
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  x: "X (Twitter)",
  threads: "Threads",
};

const HOST_MAP: Array<[string, Platform]> = [
  ["youtube.com", "youtube"],
  ["youtu.be", "youtube"],
  ["yt.be", "youtube"],
  ["tiktok.com", "tiktok"],
  ["vm.tiktok.com", "tiktok"],
  ["vt.tiktok.com", "tiktok"],
  ["instagram.com", "instagram"],
  ["instagr.am", "instagram"],
  ["facebook.com", "facebook"],
  ["fb.com", "facebook"],
  ["fb.watch", "facebook"],
  ["x.com", "x"],
  ["twitter.com", "x"],
  ["threads.net", "threads"],
  ["threads.com", "threads"],
];

const URL_RE = /\bhttps?:\/\/\S+/i;

export function extractUrl(text: string): string | null {
  return text.match(URL_RE)?.[0]?.replace(/[)>,.;"']+$/, "") ?? null;
}

export function detectPlatform(url: string): Platform | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
  for (const [domain, platform] of HOST_MAP) {
    if (host === domain || host.endsWith(`.${domain}`)) return platform;
  }
  return null;
}

export function hasVideoPath(url: string, platform: Platform): boolean {
  try {
    const { pathname } = new URL(url);
    switch (platform) {
      case "youtube":
        return /\/(watch|shorts|live|embed|v)\//i.test(pathname) ||
          /youtu\.be\/[\w-]+/i.test(url);
      case "tiktok":
        return /\/(video|photo)\/\d+/i.test(pathname) || /^(\/)?(vm|vt)\./i.test(url);
      case "instagram":
        return /\/(p|reel|reels|tv)\/[\w-]+/i.test(pathname);
      case "facebook":
        return /\/(video|watch|reel|stories)\/|\/\d+\/(\d+)\/?|fb\.watch/i.test(pathname);
      case "x":
        return /\/status\/\d+/i.test(pathname);
      case "threads":
        return /\/(post|thread)\/[\w-]+/i.test(pathname);
    }
  } catch {
    return false;
  }
  return false;
}
