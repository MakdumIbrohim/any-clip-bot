import assert from "node:assert";
import { detectPlatform, extractUrl, hasVideoPath } from "../src/detect.js";

assert.equal(detectPlatform("https://youtu.be/dQw4w9WgXcQ"), "youtube");
assert.equal(
  detectPlatform("https://www.youtube.com/shorts/abc123"),
  "youtube",
);
assert.equal(detectPlatform("https://m.youtube.com/watch?v=x"), "youtube");
assert.equal(
  detectPlatform("https://www.tiktok.com/@user/video/123"),
  "tiktok",
);
assert.equal(detectPlatform("https://vt.tiktok.com/ZScATk/"), "tiktok");
assert.equal(
  detectPlatform("https://www.instagram.com/reel/Cabc/"),
  "instagram",
);
assert.equal(
  detectPlatform("https://www.facebook.com/watch/?v=123"),
  "facebook",
);
assert.equal(detectPlatform("https://x.com/user/status/123"), "x");
assert.equal(detectPlatform("https://twitter.com/user/status/123"), "x");
assert.equal(
  detectPlatform("https://www.threads.net/@user/post/Cabc"),
  "threads",
);
assert.equal(detectPlatform("https://gmail.com/inbox"), null);
assert.equal(detectPlatform("not a url"), null);
assert.equal(
  extractUrl("coba ini https://youtu.be/abc ya bro"),
  "https://youtu.be/abc",
);
assert.equal(
  extractUrl("link (https://x.com/a/status/1)."),
  "https://x.com/a/status/1",
);
assert.equal(hasVideoPath("https://youtube.com/@channel", "youtube"), false);
assert.equal(hasVideoPath("https://youtube.com/watch?v=x", "youtube"), true);

console.log("detect: OK");
