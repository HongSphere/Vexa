import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  DanmakuItem,
  DownloadTask,
  PlatformId,
  SearchResultItem,
  SourcesConfig,
  VideoMetadata,
} from "../types/media";

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const SAMPLE_DANMAKU: DanmakuItem[] = [
  { time: 1.5, text: "前方高能预警！", color: "#ffffff", mode: 1 },
  { time: 3.0, text: "画质很清晰，音画同步效果很棒", color: "#38bdf8", mode: 1 },
  { time: 4.5, text: "打卡！名场面留念", color: "#facc15", mode: 5 },
  { time: 6.2, text: "播放很流畅，拖拽进度条秒开", color: "#4ade80", mode: 1 },
];

export async function getProxyPort(): Promise<number> {
  if (!isTauri()) return 19527;
  return await invoke<number>("get_proxy_port");
}

export async function parseMediaUrl(
  url: string,
  proxyUrl?: string,
  officialOnly?: boolean
): Promise<VideoMetadata> {
  return await invoke<VideoMetadata>("parse_media_url", {
    url,
    proxyUrl: proxyUrl || null,
    officialOnly: officialOnly ?? false,
  });
}

export async function searchMedia(
  query: string,
  platform: "all" | PlatformId,
  customVodApiUrl?: string,
  proxyUrl?: string
): Promise<SearchResultItem[]> {
  if (!isTauri()) return [];
  return await invoke<SearchResultItem[]>("search_media", {
    query,
    platform,
    customVodApiUrl: customVodApiUrl || null,
    proxyUrl: proxyUrl || null,
  });
}

export async function fetchDanmaku(cid: number): Promise<DanmakuItem[]> {
  if (!isTauri() || !cid) {
    return SAMPLE_DANMAKU;
  }
  try {
    const list = await invoke<DanmakuItem[]>("fetch_danmaku", { cid });
    return list.length > 0 ? list : SAMPLE_DANMAKU;
  } catch {
    return SAMPLE_DANMAKU;
  }
}

export async function startDownloadTask(params: {
  url: string;
  title: string;
  thumbnail: string;
  platformName: string;
  formatId: string;
  qualityLabel: string;
  height: number;
  audioOnly: boolean;
  downloadDir: string;
  proxyUrl?: string;
}): Promise<DownloadTask> {
  return await invoke<DownloadTask>("start_download_task", { params });
}

export async function controlDownloadTask(
  taskId: string,
  action: "pause" | "resume" | "cancel" | "open_folder"
): Promise<void> {
  if (!isTauri()) return;
  await invoke("control_download_task", { taskId, action });
}

export async function syncPlatformWebview(params: {
  url?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  windowHeight?: number;
  visible: boolean;
}): Promise<string> {
  if (!isTauri()) return params.url || "";
  return await invoke<string>("sync_platform_webview", {
    url: params.url ?? null,
    x: params.x,
    y: params.y,
    width: params.width,
    height: params.height,
    windowHeight: params.windowHeight ?? null,
    visible: params.visible,
  });
}

export async function actionPlatformWebview(
  action: "back" | "forward" | "reload" | "pause_media" | "hide" | "show"
): Promise<string> {
  if (!isTauri()) return "";
  return await invoke<string>("action_platform_webview", { action });
}

export async function getCurrentPlatformWebviewUrl(): Promise<string> {
  if (!isTauri()) return "";
  return await invoke<string>("current_platform_webview_url");
}

export function subscribePlatformWebviewUrl(
  callback: (payload: { url: string; platform: string }) => void
): Promise<() => void> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<{ url: string; platform: string }>(
    "platform-webview-url",
    (event) => {
      callback(event.payload);
    }
  );
}

export function subscribeDownloadProgress(
  callback: (task: DownloadTask) => void
): Promise<() => void> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<DownloadTask>("download-progress", (event) => {
    callback(event.payload);
  });
}

export interface UpdateState {
  checking: boolean;
  downloaded: boolean;
  version?: string | null;
  error: boolean;
  message: string;
}

export async function getUpdaterState(): Promise<UpdateState> {
  if (!isTauri()) {
    return {
      checking: false,
      downloaded: false,
      version: null,
      error: false,
      message: "已是最新版本",
    };
  }
  return await invoke<UpdateState>("commands_updater_state");
}

export async function checkAppUpdate(force = true): Promise<UpdateState> {
  if (!isTauri()) {
    return {
      checking: false,
      downloaded: false,
      version: null,
      error: false,
      message: "已是最新版本",
    };
  }
  return await invoke<UpdateState>("commands_updater_check", { force });
}

export async function installAppUpdate(): Promise<void> {
  if (!isTauri()) return;
  await invoke("commands_updater_install");
}

export function subscribeUpdaterState(
  callback: (state: UpdateState) => void
): Promise<() => void> {
  if (!isTauri()) return Promise.resolve(() => {});
  return listen<UpdateState>("updater:state", (event) => {
    callback(event.payload);
  });
}

export async function getSourcesConfig(): Promise<SourcesConfig> {
  if (!isTauri()) {
    try {
      const stored = localStorage.getItem("vexa_sources_config");
      if (stored) return JSON.parse(stored);
    } catch {}
    return { sites: [], vodProviders: [], parseLines: [] };
  }
  return invoke<SourcesConfig>("get_sources_config");
}

export async function saveSourcesConfig(config: SourcesConfig): Promise<void> {
  if (!isTauri()) {
    try {
      localStorage.setItem("vexa_sources_config", JSON.stringify(config));
    } catch {}
    return;
  }
  return invoke("save_sources_config", { config });
}

export async function importSourcesJson(jsonContent: string): Promise<SourcesConfig> {
  if (!isTauri()) {
    const parsed = JSON.parse(jsonContent);
    try {
      localStorage.setItem("vexa_sources_config", jsonContent);
    } catch {}
    return parsed;
  }
  return invoke<SourcesConfig>("import_sources_json", { jsonContent });
}

export async function importSourcesUrl(url: string): Promise<SourcesConfig> {
  if (!isTauri()) {
    throw new Error("仅桌面客户端支持从远程 URL 拉取订阅规则");
  }
  return invoke<SourcesConfig>("import_sources_url", { url });
}

export async function resetSourcesConfig(): Promise<void> {
  if (!isTauri()) {
    try {
      localStorage.removeItem("vexa_sources_config");
    } catch {}
    return;
  }
  return invoke("reset_sources_config");
}

export async function loadLocalSourcesFile(path?: string): Promise<SourcesConfig> {
  if (!isTauri()) {
    throw new Error("仅桌面客户端支持读取本地规则文件");
  }
  return invoke<SourcesConfig>("load_local_sources_file", { path });
}
