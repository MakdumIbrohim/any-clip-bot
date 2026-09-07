import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY,
  username TEXT,
  blocked INTEGER NOT NULL DEFAULT 0,
  day TEXT NOT NULL DEFAULT '',
  downloads_today INTEGER NOT NULL DEFAULT 0,
  total_downloads INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  platform TEXT,
  kind TEXT,
  ok INTEGER NOT NULL,
  detail TEXT
);
`);

const today = () => new Date().toISOString().slice(0, 10);

const getUserStmt = db.prepare("SELECT * FROM users WHERE user_id = ?");
const touchUserStmt = db.prepare(`
  INSERT INTO users (user_id, username, day, downloads_today, updated_at)
  VALUES (?, ?, ?, 0, ?)
  ON CONFLICT(user_id) DO UPDATE SET username = excluded.username, updated_at = excluded.updated_at
`);
const consumeStmt = db.prepare(`
  UPDATE users
  SET downloads_today = CASE WHEN day = ? THEN downloads_today + 1 ELSE 1 END,
      day = ?,
      total_downloads = total_downloads + 1,
      updated_at = ?
  WHERE user_id = ?
`);
const setBlockedStmt = db.prepare("UPDATE users SET blocked = ? WHERE user_id = ?");
const upsertUserStmt = db.prepare(`
  INSERT INTO users (user_id, blocked, day, downloads_today, updated_at)
  VALUES (?, 0, '', 0, ?)
  ON CONFLICT(user_id) DO NOTHING
`);

export type UserRow = {
  user_id: number;
  username: string | null;
  blocked: number;
  day: string;
  downloads_today: number;
  total_downloads: number;
};

export function ensureUser(userId: number, username?: string): UserRow {
  touchUserStmt.run(userId, username ?? null, today(), Date.now());
  return getUserStmt.get(userId) as UserRow;
}

export function isBlocked(userId: number): boolean {
  const row = getUserStmt.get(userId) as UserRow | undefined;
  return !!row?.blocked;
}

export function setBlocked(userId: number, blocked: boolean): boolean {
  upsertUserStmt.run(userId, Date.now());
  setBlockedStmt.run(blocked ? 1 : 0, userId);
  return !!getUserStmt.get(userId);
}

export function quotaUsed(userId: number): number {
  const row = getUserStmt.get(userId) as UserRow | undefined;
  if (!row || row.day !== today()) return 0;
  return row.downloads_today;
}

export function consumeQuota(userId: number): void {
  consumeStmt.run(today(), today(), Date.now(), userId);
}

export function getSetting(key: string, fallback: string): string {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function effectiveDailyLimit(): number {
  return Number(getSetting("daily_limit", String(config.dailyLimit))) || config.dailyLimit;
}

export function logEvent(
  userId: number,
  platform: string | null,
  kind: string | null,
  ok: boolean,
  detail?: string
): void {
  db.prepare("INSERT INTO logs (ts, user_id, platform, kind, ok, detail) VALUES (?, ?, ?, ?, ?, ?)").run(
    Date.now(),
    userId,
    platform,
    kind,
    ok ? 1 : 0,
    detail ?? null
  );
}

export function statsSummary() {
  const since = Date.now() - 24 * 3600 * 1000;
  const requests = db
    .prepare("SELECT COUNT(*) c FROM logs WHERE ts >= ?")
    .get(since) as { c: number };
  const ok = db
    .prepare("SELECT COUNT(*) c FROM logs WHERE ts >= ? AND ok = 1")
    .get(since) as { c: number };
  const byPlatform = db
    .prepare(
      `SELECT platform, COUNT(*) total, SUM(ok) success FROM logs
       WHERE ts >= ? AND platform IS NOT NULL GROUP BY platform ORDER BY total DESC`
    )
    .all(since) as Array<{ platform: string; total: number; success: number }>;
  const activeUsers = db
    .prepare("SELECT COUNT(DISTINCT user_id) c FROM logs WHERE ts >= ?")
    .get(since) as { c: number };
  const avgMs = db
    .prepare(
      `SELECT AVG(CAST(json_extract(detail, '$.ms') AS INTEGER)) avg_ms FROM logs
       WHERE ts >= ? AND ok = 1 AND detail LIKE '{%'`
    )
    .get(since) as { avg_ms: number | null };
  return {
    requests24h: requests.c,
    success24h: ok.c,
    failed24h: requests.c - ok.c,
    activeUsers24h: activeUsers.c,
    avgMs: avgMs.avg_ms,
    byPlatform,
  };
}

export function topUsers(limit = 10) {
  return db
    .prepare(
      `SELECT user_id, username, total_downloads FROM users ORDER BY total_downloads DESC LIMIT ?`
    )
    .all(limit) as Array<{ user_id: number; username: string | null; total_downloads: number }>;
}

export function recentErrors(limit = 10) {
  return db
    .prepare("SELECT ts, user_id, platform, detail FROM logs WHERE ok = 0 ORDER BY id DESC LIMIT ?")
    .all(limit) as Array<{ ts: number; user_id: number; platform: string | null; detail: string | null }>;
}
