import type { ChildProcess } from "node:child_process";
import PQueue from "p-queue";
import { config } from "../config.js";
import { consumeQuota, logEvent } from "../db.js";
import type { Platform } from "../platforms/index.js";
import type { VideoInfo } from "./extractor.js";

export type JobKind = { type: "video"; height: number } | { type: "audio" } | { type: "image" };

export type JobResult =
  | { ok: true; path: string; size: number; ms: number }
  | { ok: false; code: "too_big"; size: number; path: string }
  | { ok: false; code: "error"; message: string }
  | { ok: false; code: "cancelled" };

export type DownloadJob = {
  id: string;
  chatId: number;
  userId: number;
  statusMessageId?: number;
  info: VideoInfo;
  platform: Platform;
  kind: JobKind;
  queuedAt: number;
  startedAt?: number;
  cancelled: boolean;
  child?: ChildProcess;
  promise: Promise<JobResult>;
};

export type JobRunner = (
  job: DownloadJob,
  report: (percent: number | null, stage: string) => void
) => Promise<JobResult>;

const queue = new PQueue({
  concurrency: config.concurrency,
  timeout: config.queueTimeoutSec * 1000,
});

const active = new Map<string, DownloadJob>();

let runner: JobRunner | null = null;
let reporter: ((job: DownloadJob, percent: number | null, stage: string) => void) | null = null;
let counter = 0;

export function initQueue(r: JobRunner, onProgress: (job: DownloadJob, percent: number | null, stage: string) => void): void {
  runner = r;
  reporter = onProgress;
}

export function queueDepth(): number {
  return queue.size;
}

export function queueRunning(): number {
  return queue.pending;
}

export function cancelJob(job: DownloadJob): void {
  job.cancelled = true;
  if (job.child && !job.child.killed) {
    try {
      job.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

export function enqueue(params: {
  chatId: number;
  userId: number;
  platform: Platform;
  kind: JobKind;
  info: VideoInfo;
  statusMessageId?: number;
}): DownloadJob {
  if (!runner || !reporter) throw new Error("queue belum diinisialisasi");
  const id = `${Date.now().toString(36)}-${(++counter).toString(36)}`;
  let resolvePromise!: (r: JobResult) => void;
  const promise = new Promise<JobResult>((res) => {
    resolvePromise = res;
  });

  const job: DownloadJob = {
    id,
    chatId: params.chatId,
    userId: params.userId,
    platform: params.platform,
    kind: params.kind,
    info: params.info,
    statusMessageId: params.statusMessageId,
    queuedAt: Date.now(),
    cancelled: false,
    promise,
  };

  active.set(id, job);

  void queue.add(async () => {
    if (job.cancelled) {
      active.delete(id);
      resolvePromise({ ok: false, code: "cancelled" });
      return;
    }
    job.startedAt = Date.now();
    try {
      const res = await runner!(job, (pct, stage) => reporter!(job, pct, stage));
      if (res.ok) {
        consumeQuota(job.userId);
        logEvent(job.userId, job.platform, job.kind.type, true);
      } else if (res.code === "too_big") {
        logEvent(job.userId, job.platform, job.kind.type, false, `too_big: ${res.size}`);
      }
      resolvePromise(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logEvent(job.userId, job.platform, job.kind.type, false, msg.slice(0, 200));
      resolvePromise({ ok: false, code: "error", message: msg });
    } finally {
      active.delete(id);
    }
  });

  return job;
}
