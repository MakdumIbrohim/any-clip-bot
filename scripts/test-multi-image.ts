import assert from "node:assert";
import { fetchInfo } from "../src/services/extractor.js";
import { runDownload, cleanupJobDir } from "../src/services/downloader.js";
import type { DownloadJob } from "../src/services/queue.js";

async function main() {
  console.log("=== Testing TikTok Photo Slide Extract & Download ===");
  const ttUrl = "https://vt.tiktok.com/ZSq6n1PVD/";
  const info = await fetchInfo(ttUrl, "tiktok");
  console.log("TikTok Info:", {
    title: info.title.slice(0, 40),
    isImage: info.isImage,
    imagesCount: info.images?.length,
  });

  assert.equal(info.isImage, true);
  assert.ok((info.images?.length ?? 0) > 1);

  const mockJob: DownloadJob = {
    id: "test_slide_job",
    chatId: 12345,
    userId: 12345,
    info,
    platform: "tiktok",
    kind: { type: "image" },
    queuedAt: Date.now(),
    cancelled: false,
    promise: Promise.resolve({ ok: true, path: "", size: 0, ms: 0 }),
  };

  const res = await runDownload(mockJob, (pct, stage) => {
    console.log(`[Progress] ${pct}% - ${stage}`);
  });

  console.log("Download Result:", {
    ok: res.ok,
    pathsCount: res.ok ? res.paths?.length : 0,
    size: res.ok ? res.size : 0,
  });

  assert.equal(res.ok, true);
  if (res.ok) {
    assert.ok((res.paths?.length ?? 0) > 1);
  }

  cleanupJobDir(mockJob);
  console.log("Cleanup OK. Test Passed!");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
