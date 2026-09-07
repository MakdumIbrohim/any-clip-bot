import type { PlatformConfig } from "./types.js";

export const instagramPlatform: PlatformConfig = {
  id: "instagram",
  name: "Instagram",
  domains: ["instagram.com", "instagr.am"],
  hasVideoPath: (_url, pathname) => /\/(p|reel|reels|tv)\/[\w-]+/i.test(pathname),
};
