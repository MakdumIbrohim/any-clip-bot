import type { PlatformConfig } from "./types.js";

export const youtubePlatform: PlatformConfig = {
  id: "youtube",
  name: "YouTube",
  domains: ["youtube.com", "youtu.be", "yt.be"],
  hasVideoPath: (url, pathname) =>
    /\/(watch|shorts|live|embed|v)(\/|\?|$)/i.test(pathname) ||
    /youtu\.be\/[\w-]+/i.test(url),
};
