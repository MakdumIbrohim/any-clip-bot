import type { PlatformConfig } from "./types.js";

export const xPlatform: PlatformConfig = {
  id: "x",
  name: "X (Twitter)",
  domains: ["x.com", "twitter.com"],
  hasVideoPath: (_url, pathname) => /\/status\/\d+/i.test(pathname),
};
