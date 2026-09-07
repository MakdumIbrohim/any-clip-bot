import type { ChildProcess } from "node:child_process";
import PQueue from "p-queue";
import { config } from "./config.js";
import { consumeQuota, logEvent } from "./db.js";
import type { Platform } from "./detect.js";
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
  return queue.pending + active.size;
}

export function enqueue(params: {
  chatId: number;
  userId: number;
  platform: Platform;
  kind: JobKind;
  info: VideoInfo;
  statusMessageId?: number;
}): DownloadJob {
  if (!runner) throw new Error("queue belum di-init");
  let resolveFn!: (r: JobResult) => void;
  const promise = new Promise<JobResult>((res) => (resolveFn = res));
  const job: DownloadJob = {
    id: `j${Date.now().toString(36)}_${counter++}`,
    ...params,
    queuedAt: Date.now(),
    cancelled: false,
    promise,
  };
  active.set(job.id, job);

  void queue
    .add(async () => {
      if (job.cancelled) {
        resolveFn({ ok: false, code: "cancelled" });
        active.delete(job.id);
        return;
      }
      job.startedAt = Date.now();
      let lastPct = -100;
      let lastStage = "";
      let lastSent = 0;
      try {
        const result = await runner!(job, (percent, stage) => {
          const now = Date.now();
          const meaningful =
            stage !== lastStage || (percent !== null && Math.abs(percent - lastPct) >= 4);
          if (meaningful && now - lastSent >= 1500) {
            lastSent = now;
            lastStage = stage;
            if (percent !== null) lastPct = percent;
            reporter?.(job, percent, stage);
          }
        });
        if (result.ok) {
          consumeQuota(job.userId);
          logEvent(job.userId, job.platform, job.kind.type, true,
            JSON.stringify({ ms: Date.now() - (job.startedAt ?? Date.now()), size: result.size }));
        } else if (result.code !== "cancelled") {
          logEvent(job.userId, job.platform, job.kind.type, false,
            result.code === "too_big" ? `too_big ${result.size}` : result.message.slice(0, 200));
        }
        resolveFn(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logEvent(job.userId, job.platform, job.kind.type, false, message.slice(0, 200));
        resolveFn({ ok: false, code: "error", message });
      } finally {
        active.delete(job.id);
      }
    })
    .catch(() => {
      resolveFn({ ok: false, code: "error", message: "Antrian penuh atau proses terlalu lama. Coba lagi nanti." });
      active.delete(job.id);
    });

  return job;
}

export function cancelJob(job: DownloadJob): void {
  job.cancelled = true;
  job.child?.kill("SIGKILL");
}

export function findJobByChatMessage(chatId: number, messageId: number): DownloadJob | undefined {
  for (const job of active.values()) {
    if (job.chatId === chatId && job.statusMessageId === messageId) return job;
  }
}
