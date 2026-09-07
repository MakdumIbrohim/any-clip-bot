import { facebookPlatform } from "./facebook.js";
import { instagramPlatform } from "./instagram.js";
import { threadsPlatform } from "./threads.js";
import { tiktokPlatform } from "./tiktok.js";
import type { PlatformConfig, PlatformId } from "./types.js";
import { xPlatform } from "./x.js";
import { youtubePlatform } from "./youtube.js";

export * from "./types.js";

export const PLATFORMS: PlatformConfig[] = [
  youtubePlatform,
  tiktokPlatform,
  instagramPlatform,
  facebookPlatform,
  xPlatform,
  threadsPlatform,
];

const platformMap = new Map<PlatformId, PlatformConfig>(
  PLATFORMS.map((p) => [p.id, p])
);

export function getPlatformConfig(id: PlatformId): PlatformConfig | undefined {
  return platformMap.get(id);
}
