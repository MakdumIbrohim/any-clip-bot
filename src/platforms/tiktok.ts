import type { PlatformConfig } from "./types.js";

export const tiktokPlatform: PlatformConfig = {
  id: "tiktok",
  name: "TikTok",
  domains: ["tiktok.com", "vm.tiktok.com", "vt.tiktok.com"],
  hasVideoPath: (url, pathname) =>
    /\/(video|photo)\/\d+/i.test(pathname) || /^(\/)?(vm|vt)\./i.test(url),
};
