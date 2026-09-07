# AnyClip Bot

Bot Telegram pengunduh video & audio multi-platform.

**Platform didukung:** YouTube, TikTok, Instagram, Facebook, X (Twitter), Threads

**Alur:** Kirim link → lihat pratinjau (thumbnail, judul, durasi, estimasi ukuran) → pilih format/resolusi → terima file.

---

## Prasyarat

| Kebutuhan | Versi |
|---|---|
| Node.js | ≥ 20 |
| yt-dlp | Terbaru |
| ffmpeg | ≥ 4 (untuk MP3 / mux MP4) |

### Install yt-dlp

```bash
# Linux/macOS — binary langsung
mkdir -p ~/.local/bin
curl -sL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ~/.local/bin/yt-dlp
chmod +x ~/.local/bin/yt-dlp
```

### Install ffmpeg

```bash
# Ubuntu/Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

> ffmpeg-static (npm) sudah termasuk sebagai fallback otomatis jika `ffmpeg` tidak ada di PATH.

---

## Setup

```bash
# 1. Clone/extract proyek
cd any-clip-bot

# 2. Install dependensi
npm install

# 3. Buat .env dari template
cp .env.example .env
```

Edit `.env`:

```env
BOT_TOKEN=123456:ABC-ganti-dengan-token-dari-BotFather
ADMIN_IDS=12345678          # user_id Telegram kamu (lihat @userinfobot)
DAILY_LIMIT=10              # batas unduhan per user per hari
```

---

## Jalankan

```bash
# Development (hot-reload)
npm run dev

# Produksi
npm run build
npm start
```

---

## Perintah Bot

| Perintah | Keterangan |
|---|---|
| `/start` atau `/help` | Panduan penggunaan & disclaimer |
| `/status` | Kuota hari ini + posisi antrian |
| `/cancel` | Batalkan unduhan berjalan |

### Perintah Admin (user_id harus ada di `ADMIN_IDS`)

| Perintah | Contoh | Keterangan |
|---|---|---|
| `/stats` | `/stats` | Statistik 24 jam: request, sukses, error, per-platform, top user |
| `/block` | `/block 123456` | Blokir user dari bot |
| `/unblock` | `/unblock 123456` | Cabut blokir |
| `/limit` | `/limit 20` | Ubah kuota harian (berlaku langsung) |
| `/user` | `/user 123456` | Lihat pemakaian kuota user tertentu |
| `/mode` | `/mode whitelist` | Ganti mode akses: `public` / `whitelist` |

---

## Batasan Upload Bot API

Bot API standar: **maks 50 MB per file**.

Kalau file melebihi batas, bot memberitahu ukurannya dan menyarankan resolusi lebih rendah atau format MP3.

Untuk melewati limit 50 MB (sampai 2 GB), jalankan [Local Bot API Server](https://github.com/tdlib/telegram-bot-api) dan set `YTDLP_PATH` / arahkan bot ke server lokal.

---

## Struktur Proyek

```
src/
  index.ts        — entry point, validasi env, mulai polling
  bot.ts          — handler pesan + callback, preview, kirim file
  admin.ts        — perintah admin
  queue.ts        — antrian job (p-queue)
  downloader.ts   — yt-dlp subprocess, estimasi ukuran, cleanup
  extractor.ts    — fetch info video via yt-dlp -J
  detect.ts       — deteksi platform dari URL
  config.ts       — env/config
  db.ts           — SQLite (quota, log, user, settings)
scripts/
  test-detect.ts  — unit test deteksi URL
  test-pipeline.ts — integrasi: fetch info + opsional download
data/             — DB + file sementara (auto-dibuat, jangan di-commit)
```

---

## Tes

```bash
# Unit test deteksi URL
npx tsx scripts/test-detect.ts

# Tes info video (butuh internet)
npx tsx scripts/test-pipeline.ts "https://youtu.be/dQw4w9WgXcQ"

# Tes unduh MP3 end-to-end
npx tsx scripts/test-pipeline.ts "https://youtu.be/dQw4w9WgXcQ" download
```

---

## Konfigurasi Lengkap `.env`

```env
BOT_TOKEN=                    # Wajib
ADMIN_IDS=                    # user_id admin, pisah koma
ACCESS_MODE=public             # public | whitelist
WHITELIST_IDS=                 # user_id diizinkan jika whitelist, pisah koma
DAILY_LIMIT=10                 # unduhan sukses per user per hari
MAX_RESOLUTION=1080            # resolusi tertinggi yang ditawarkan (mis. 720)
MAX_UPLOAD_MB=50               # batas upload ke Telegram
CONCURRENCY=2                  # job paralel
QUEUE_TIMEOUT_SEC=900          # timeout per job (detik)
YOUTUBE_COOKIES_TXT=           # path cookies.txt untuk konten YouTube age-restrict
YTDLP_PATH=yt-dlp              # path binary yt-dlp jika tidak di PATH
FFMPEG_PATH=                   # path ffmpeg; kosong = pakai ffmpeg-static fallback
DB_PATH=data/anyclip.db
TMP_DIR=data/tmp
```

---

## Legal

Bot ini untuk keperluan pribadi/edukasi. Mengunduh konten platform lain dapat melanggar Terms of Service platform tersebut dan hak cipta konten. Pengguna bertanggung jawab atas konten yang diunduh.
