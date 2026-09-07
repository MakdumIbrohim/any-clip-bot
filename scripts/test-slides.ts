import assert from "node:assert";
import { fetchInfo } from "../src/services/extractor.js";

async function main() {
  console.log("=== 1. Test TikTok Photo ===");
  const ttPhotoUrl = "https://vt.tiktok.com/ZSq6n1PVD/";
  const ttInfo = await fetchInfo(ttPhotoUrl, "tiktok");
  console.log("TikTok Photo result:", {
    id: ttInfo.id,
    title: ttInfo.title,
    uploader: ttInfo.uploader,
    isImage: ttInfo.isImage,
    thumbnail: ttInfo.thumbnail?.slice(0, 50),
    webpageUrl: ttInfo.webpageUrl?.slice(0, 50),
  });

  assert.equal(ttInfo.platform, "tiktok");
  assert.equal(ttInfo.isImage, true);
  assert.ok(ttInfo.webpageUrl.startsWith("https://"));

  console.log("\n=== 2. Test Instagram Carousel/Image ===");
  const igPhotoUrl = "https://www.instagram.com/p/Dc-0Bq0MIjc/";
  const igInfo = await fetchInfo(igPhotoUrl, "instagram");
  console.log("Instagram Photo result:", {
    id: igInfo.id,
    title: igInfo.title?.slice(0, 50),
    uploader: igInfo.uploader,
    isImage: igInfo.isImage,
    thumbnail: igInfo.thumbnail?.slice(0, 50),
    webpageUrl: igInfo.webpageUrl?.slice(0, 50),
  });

  assert.equal(igInfo.platform, "instagram");
  assert.equal(igInfo.isImage, true);
  assert.ok(igInfo.webpageUrl.startsWith("https://"));

  console.log("\nAll Slide/Photo tests passed!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
