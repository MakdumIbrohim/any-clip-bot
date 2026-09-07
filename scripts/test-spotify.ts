import { detectPlatform } from "../src/platforms/index.js";
import { fetchInfo } from "../src/services/extractor.js";
import { runDownload } from "../src/services/downloader.js";
import type { DownloadJob } from "../src/services/queue.js";

async function main() {
  const url = "https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT";
  const platform = detectPlatform(url);
  console.log("1. Platform detected:", platform);
  if (!platform) throw new Error("Platform detection failed");

  console.log("2. Fetching Spotify info...");
  const info = await fetchInfo(url, platform);
  console.log("Track Info:", {
    id: info.id,
    title: info.title,
    uploader: info.uploader,
    duration: info.duration,
    thumbnail: info.thumbnail,
    formatsCount: info.formats.length,
  });

  console.log("3. Testing Spotify MP3 download & tag embedding...");
  const dummyJob: DownloadJob = {
    id: "test_spotify_" + Date.now(),
    chatId: 12345,
    userId: 12345,
    platform: "spotify",
    info,
    kind: { type: "audio" },
    queuedAt: Date.now(),
    cancelled: false,
    promise: Promise.resolve({ ok: true } as any),
  };

  const result = await runDownload(dummyJob, (percent, stage) => {
    console.log(`[download progress] ${stage} ${percent ?? ""}%`);
  });

  console.log("Download result:", result);
}

main().catch((err) => {
  console.error("Error in test:", err);
  process.exit(1);
});
