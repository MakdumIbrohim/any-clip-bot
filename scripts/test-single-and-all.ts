import assert from "node:assert";
import { fetchInfo } from "../src/services/extractor.js";
import { runDownload, cleanupJobDir } from "../src/services/downloader.js";
import type { DownloadJob } from "../src/services/queue.js";

async function testSingleAndAll() {
  console.log("=== Testing Single Slide vs All Slides ===");
  const ttUrl = "https://vt.tiktok.com/ZSq6n1PVD/";
  const info = await fetchInfo(ttUrl, "tiktok");

  assert.equal(info.isImage, true);
  assert.ok((info.images?.length ?? 0) > 1);

  // 1. Unduh SATU gambar (misal Foto 3)
  const singleJob: DownloadJob = {
    id: "test_single_slide",
    chatId: 12345,
    userId: 12345,
    info,
    platform: "tiktok",
    kind: { type: "image", index: 3 },
    queuedAt: Date.now(),
    cancelled: false,
    promise: Promise.resolve({ ok: true, path: "", size: 0, ms: 0 }),
  };

  const singleRes = await runDownload(singleJob, (pct, stage) => {
    // quiet
  });

  console.log("Single Photo Result:", {
    ok: singleRes.ok,
    singlePath: singleRes.ok ? singleRes.path : null,
    paths: singleRes.ok ? singleRes.paths : null,
  });

  assert.equal(singleRes.ok, true);
  if (singleRes.ok) {
    assert.equal(singleRes.paths, undefined); // Harus single, bukan array album
    assert.ok(singleRes.path.includes("slide_003"));
  }
  cleanupJobDir(singleJob);

  // 2. Unduh SEMUA gambar (album)
  const allJob: DownloadJob = {
    id: "test_all_slides",
    chatId: 12345,
    userId: 12345,
    info,
    platform: "tiktok",
    kind: { type: "image" },
    queuedAt: Date.now(),
    cancelled: false,
    promise: Promise.resolve({ ok: true, path: "", size: 0, ms: 0 }),
  };

  const allRes = await runDownload(allJob, (pct, stage) => {
    // quiet
  });

  console.log("All Photos Result:", {
    ok: allRes.ok,
    pathsCount: allRes.ok ? allRes.paths?.length : 0,
  });

  assert.equal(allRes.ok, true);
  if (allRes.ok) {
    assert.equal(allRes.paths?.length, info.images?.length);
  }
  cleanupJobDir(allJob);

  console.log("Single and All Slides test passed!");
}

testSingleAndAll().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
