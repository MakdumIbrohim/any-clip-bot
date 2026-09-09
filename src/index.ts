import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { assertConfig, config } from "./config.js";
import "./db.js";
import { bot } from "./bot/index.js";
import { sweepStaleTmp } from "./services/index.js";

function checkBinary(name: string, bin: string): boolean {
  try {
    const out = execFileSync(bin, ["-version"], { encoding: "utf8", timeout: 15_000 });
    console.log(`[init] ${name} OK (${out.trim().split("\n")[0].slice(0, 80)})`);
    return true;
  } catch {
    try {
      const out2 = execFileSync(bin, ["--version"], { encoding: "utf8", timeout: 15_000 });
      console.log(`[init] ${name} ${out2.trim().split("\n")[0].slice(0, 80)}`);
      return true;
    } catch {
      console.error(`[init] ${name} tidak ditemukan ('${bin}'). Bot butuh ${name} untuk memproses video.`);
      return false;
    }
  }
}

assertConfig();
fs.mkdirSync(config.tmpDir, { recursive: true });
sweepStaleTmp();

// Jalankan pembersihan file sementara secara berkala (tiap 30 menit)
setInterval(() => {
  sweepStaleTmp();
}, 30 * 60 * 1000).unref();

const okYtDlp = checkBinary("yt-dlp", config.bin.ytDlp);
const okFfmpeg = checkBinary("ffmpeg", config.bin.ffmpeg);
if (!okYtDlp) process.exit(1);
if (!okFfmpeg) console.error("[init] tanpa ffmpeg, konversi MP3/muxing MP4 akan gagal.");

if (config.accessMode === "whitelist") {
  console.log(`[init] mode whitelist: ${config.whitelistIds.size} user diizinkan + admin.`);
}

process.once("SIGINT", () => {
  console.log("[init] berhenti...");
  void bot.stop();
  setTimeout(() => process.exit(0), 500);
});

console.log("[init] Snap Save Kit Bot jalan (polling).");
await bot.start({
  onStart: (me) => console.log(`[init] @${me.username} siap menerima link.`),
});
