import type { VideoInfo } from "../services/extractor.js";
import type { DownloadJob } from "../services/queue.js";

export type PlatformId =
  | "youtube"
  | "tiktok"
  | "instagram"
  | "facebook"
  | "x"
  | "threads";

export interface PlatformConfig {
  id: PlatformId;
  name: string;
  domains: string[];
  hasVideoPath: (url: string, pathname: string) => boolean;
  fetchInfo?: (url: string) => Promise<VideoInfo>;
  buildDownloadArgs?: (job: DownloadJob, dir: string) => string[] | null;
}
