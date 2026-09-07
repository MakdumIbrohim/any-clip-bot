import { facebookPlatform } from "./facebook.js";
import { instagramPlatform } from "./instagram.js";
import { spotifyPlatform } from "./spotify.js";
import { threadsPlatform } from "./threads.js";
import { tiktokPlatform } from "./tiktok.js";
import type { PlatformConfig, PlatformId } from "./types.js";
import { xPlatform } from "./x.js";
import { youtubePlatform } from "./youtube.js";

export * from "./types.js";

export type Platform = PlatformId;

export const PLATFORMS: PlatformConfig[] = [
  youtubePlatform,
  tiktokPlatform,
  instagramPlatform,
  facebookPlatform,
  xPlatform,
  threadsPlatform,
  spotifyPlatform,
];

export const SUPPORTED_PLATFORMS: Platform[] = PLATFORMS.map((p) => p.id);

export const PLATFORM_LABEL: Record<Platform, string> = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p.name])
) as Record<Platform, string>;

const platformMap = new Map<PlatformId, PlatformConfig>(
  PLATFORMS.map((p) => [p.id, p])
);

export function getPlatformConfig(id: PlatformId): PlatformConfig | undefined {
  return platformMap.get(id);
}

const HOST_MAP: Array<[string, Platform]> = [];
for (const p of PLATFORMS) {
  for (const domain of p.domains) {
    HOST_MAP.push([domain, p.id]);
  }
}

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
    const p = platformMap.get(platform);
    if (!p) return false;
    return p.hasVideoPath(url, pathname);
  } catch {
    return false;
  }
}
