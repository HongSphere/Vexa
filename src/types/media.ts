export type PlatformId = string;

export type ThemeMode = "light" | "dark" | "system";

export interface VideoFormat {
  formatId: string;
  qualityLabel: string;
  height: number;
  fps?: number;
  ext: string;
  vcodec: string;
  acodec: string;
  filesize?: number;
  videoUrl: string;
  audioUrl?: string;
  isDash: boolean;
  isHls: boolean;
  headers?: Record<string, string>;
}

export interface EpisodeItem {
  index: number;
  id: string;
  cid?: number;
  title: string;
  duration: number;
  url: string;
}

export interface SubtitleTrack {
  lang: string;
  label: string;
  url: string;
}

export interface DanmakuItem {
  time: number;
  text: string;
  color: string;
  mode: number;
}

export interface MediaSource {
  sourceId: string;
  sourceName: string;
  matchedTitle: string;
  remarks: string;
  sourceType: "m3u8" | "native" | "jx_iframe" | string;
  playUrl: string;
  episodes: EpisodeItem[];
  formats?: VideoFormat[];
}

export interface VideoMetadata {
  id: string;
  url: string;
  title: string;
  uploader: string;
  thumbnail: string;
  duration: number;
  viewCount?: number;
  description?: string;
  platform: PlatformId;
  platformName: string;
  cid?: number;
  formats: VideoFormat[];
  episodes: EpisodeItem[];
  currentEpisodeIndex: number;
  subtitles: SubtitleTrack[];
  authUsed: "official_login" | "guest_boost";
  sources?: MediaSource[];
  activeSourceId?: string;
}

export interface SearchResultItem {
  id: string;
  url: string;
  title: string;
  uploader: string;
  thumbnail: string;
  duration: number;
  viewCount?: string;
  platform: PlatformId;
  platformName: string;
  badge?: string;
}

export type DownloadStatus =
  | "queued"
  | "downloading_video"
  | "downloading_audio"
  | "merging"
  | "completed"
  | "paused"
  | "failed";

export interface DownloadTask {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  platformName: string;
  qualityLabel: string;
  formatId: string;
  audioOnly: boolean;
  status: DownloadStatus;
  progress: number;
  speed: string;
  eta: string;
  totalSize?: string;
  outputPath?: string;
  createdAt: number;
  errorMsg?: string;
}

export interface WatchHistoryItem {
  id: string;
  url: string;
  title: string;
  uploader: string;
  thumbnail: string;
  platform: PlatformId;
  platformName: string;
  lastPosition: number;
  duration: number;
  qualityLabel?: string;
  watchedAt: number;
  isFavorite: boolean;
}

export interface AppSettings {
  themeMode: ThemeMode;
  downloadDir: string;
  preferredQuality: number;
  danmakuEnabled: boolean;
  danmakuOpacity: number;
  danmakuArea: "quarter" | "half" | "full";
  proxyUrl: string;
  customVodApiUrl: string;
}

export interface SiteConfig {
  id: string;
  name: string;
  homeUrl: string;
  mobileHomeUrl?: string;
  searchUrlTemplate?: string;
  color?: string;
  desc?: string;
}

export interface VodProviderConfig {
  id: string;
  name: string;
  apiBase: string;
  enabled: boolean;
}

export interface ParseLineConfig {
  id: string;
  name: string;
  urlPrefix: string;
  enabled: boolean;
}

export interface SourcesConfig {
  version?: string;
  name?: string;
  sites: SiteConfig[];
  vodProviders: VodProviderConfig[];
  parseLines: ParseLineConfig[];
}
