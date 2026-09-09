# Multi-stage build
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install build dependencies for native modules (better-sqlite3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

# Production runtime stage
FROM node:22-bookworm-slim AS runner

WORKDIR /app

# Install system dependencies: python3, ffmpeg, curl (for yt-dlp download)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    ffmpeg \
    curl \
    ca-certificates \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && apt-get purge -y --auto-remove curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    YTDLP_PATH=/usr/local/bin/yt-dlp \
    FFMPEG_PATH=/usr/bin/ffmpeg

COPY package*.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

# Create persistent directory
RUN mkdir -p /app/data

VOLUME ["/app/data"]

CMD ["npm", "start"]
