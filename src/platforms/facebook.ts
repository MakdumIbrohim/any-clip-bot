import type { PlatformConfig } from "./types.js";

export const facebookPlatform: PlatformConfig = {
  id: "facebook",
  name: "Facebook",
  domains: ["facebook.com", "fb.com", "fb.watch"],
  hasVideoPath: (url, pathname) =>
    /\/(video|watch|reel|stories)\/|\/\d+\/(\d+)\/?|fb\.watch/i.test(pathname) ||
    /fb\.watch/i.test(url),
};
