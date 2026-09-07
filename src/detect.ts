import { PLATFORMS, type PlatformConfig, type PlatformId } from "./platforms/index.js";

export const SUPPORTED_PLATFORMS = PLATFORMS.map((p) => p.id);

export type Platform = PlatformId;

export const PLATFORM_LABEL: Record<Platform, string> = Object.fromEntries(
  PLATFORMS.map((p) => [p.id, p.name])
) as Record<Platform, string>;

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

const configMap = new Map<Platform, PlatformConfig>(
  PLATFORMS.map((p) => [p.id, p])
);

export function hasVideoPath(url: string, platform: Platform): boolean {
  try {
    const { pathname } = new URL(url);
    const p = configMap.get(platform);
    if (!p) return false;
    return p.hasVideoPath(url, pathname);
  } catch {
    return false;
  }
}
