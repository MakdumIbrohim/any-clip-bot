import { config } from "../src/config.js";
import { fetchInfo } from "../src/extractor.js";
import {
  availableHeights,
  estimateAudioSize,
  estimateVideoSize,
  formatBytes,
  runDownload,
} from "../src/downloader.js";
import type { DownloadJob } from "../src/queue.js";
import fs from "node:fs";
import path from "node:path";

const url = process.argv[2] ?? "https://www.youtube.com/watch?v=aqz-KE-bpKQ";

const info = await fetchInfo(url, "youtube");
console.log("title:", info.title.slice(0, 60));
console.log(
  "duration:",
  info.duration,
  "s | uploader:",
  info.uploader,
  "| thumb:",
  !!info.thumbnail,
);
const heights = availableHeights(info);
console.log("heights <= " + config.maxResolution + ":", heights.join(", "));
for (const h of heights.slice(0, 3)) {
  const size = estimateVideoSize(info, h);
  console.log(`  ${h}p ≈ ${size ? formatBytes(size) : "?"}`);
}
console.log("mp3 ≈", formatBytes(estimateAudioSize(info) ?? 0));

if (process.argv[3]?.startsWith("download")) {
  const kind =
    process.argv[3] === "download"
      ? { type: "audio" as const }
      : {
          type: "video" as const,
          height: Number(process.argv[3].split(":")[1]),
        };
  const job = {
    id: "smoke",
    chatId: 0,
    userId: 0,
    info,
    platform: "youtube",
    kind,
    queuedAt: Date.now(),
    cancelled: false,
    promise: Promise.resolve(),
  } as unknown as DownloadJob;
  fs.mkdirSync(path.join(config.tmpDir, "smoke"), { recursive: true });
  const res = await runDownload(job, (p, stage) =>
    console.log(`[${stage}] ${p ?? ""}%`),
  );
  console.log(
    "result:",
    res.ok ? `OK ${formatBytes(res.size)} -> ${res.path}` : res,
  );
  if (res.ok)
    fs.rmSync(path.join(config.tmpDir, "smoke"), {
      recursive: true,
      force: true,
    });
}
