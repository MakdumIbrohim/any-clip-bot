import assert from "node:assert";
import { fetchInfo } from "../src/extractor.js";

async function run() {
  console.log("Testing Threads Image post...");
  const imgUrl = "https://www.threads.com/@yusup_supriyadi1st/post/Dc-piAKk0G4?xmt=AQG0l4IF2o3n9oa27CweWD0ejElTTPwmew9-KIfkOiyidRJufSi8Ym713UY1pqJ6jJmsQjI&slof=1";
  const imgInfo = await fetchInfo(imgUrl, "threads");
  console.log("Image post result:", {
    id: imgInfo.id,
    title: imgInfo.title,
    uploader: imgInfo.uploader,
    isImage: imgInfo.isImage,
    thumbnail: imgInfo.thumbnail?.slice(0, 50),
    webpageUrl: imgInfo.webpageUrl?.slice(0, 50),
  });

  assert.equal(imgInfo.platform, "threads");
  assert.equal(imgInfo.isImage, true);
  assert.equal(imgInfo.uploader, "yusup_supriyadi1st");
  assert.ok(imgInfo.title.includes("clone figma"));
  assert.ok(imgInfo.webpageUrl.startsWith("https://"));

  console.log("\nTesting Threads Video post...");
  const vidUrl = "https://www.threads.com/@tntsportsbr/post/C6cqebdCfBi";
  const vidInfo = await fetchInfo(vidUrl, "threads");
  console.log("Video post result:", {
    id: vidInfo.id,
    title: vidInfo.title,
    uploader: vidInfo.uploader,
    isImage: vidInfo.isImage,
    formatsCount: vidInfo.formats.length,
    formatRes: vidInfo.formats[0]?.resolution,
    formatHeight: vidInfo.formats[0]?.height,
    webpageUrl: vidInfo.webpageUrl?.slice(0, 50),
  });

  assert.equal(vidInfo.platform, "threads");
  assert.equal(vidInfo.isImage, false);
  assert.equal(vidInfo.uploader, "tntsportsbr");
  assert.ok(vidInfo.formats.length > 0);
  assert.ok(vidInfo.webpageUrl.startsWith("https://"));

  console.log("\nAll Threads tests passed!");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
