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
  downloading?: boolean;
  downloaded: boolean;
  progress?: number | null;
  version?: string | null;
  error: boolean;
  message: string;
}

export async function setAppFullscreen(fullscreen: boolean): Promise<void> {
  if (typeof (window as any).AndroidNative?.setFullscreen === "function") {
    try {
      (window as any).AndroidNative.setFullscreen(fullscreen);
    } catch {}
  }
  if (isTauri()) {
    try {
      await invoke("commands_set_fullscreen", { fullscreen });
    } catch {}
  }
  try {
    if (fullscreen) {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
  } catch {}
}

export async function openExternalUrl(url: string): Promise<void> {
  if (typeof (window as any).AndroidNative?.openBrowser === "function") {
    try {
      (window as any).AndroidNative.openBrowser(url);
      return;
    } catch {}
  }
  if (isTauri()) {
    try {
      await invoke("commands_open_browser", { url });
      return;
    } catch {}
  }
  window.open(url, "_blank");
}

export async function getUpdaterState(): Promise<UpdateState> {
  const currentVer = "1.0.0";
  if (!isTauri()) {
    return {
      checking: false,
      downloading: false,
      downloaded: false,
      progress: null,
      version: null,
      error: false,
      message: `当前已是最新版本 (v${currentVer})`,
    };
  }
  try {
    return await invoke<UpdateState>("commands_updater_state");
  } catch {
    return {
      checking: false,
      downloading: false,
      downloaded: false,
      progress: null,
      version: null,
      error: false,
      message: `当前已是最新版本 (v${currentVer})`,
    };
  }
}

export async function checkAppUpdate(_force = true): Promise<UpdateState> {
  const currentVer = "1.0.0";
  if (!isTauri()) {
    return {
      checking: false,
      downloading: false,
      downloaded: false,
      progress: null,
      version: currentVer,
      error: false,
      message: `当前已是最新版本 (v${currentVer})`,
    };
  }

  const isMobile =
    typeof navigator !== "undefined" &&
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(
      navigator.userAgent
    );

  if (isMobile) {
    try {
      const releaseInfo = await invoke<{
        tag_name: string;
        version: string;
        download_url: string;
        release_url: string;
      }>("commands_check_latest_github_release");
      if (releaseInfo && releaseInfo.version) {
        const latestVer = releaseInfo.version;
        if (latestVer > currentVer) {
          return {
            checking: false,
            downloading: false,
            downloaded: false,
            progress: null,
            version: latestVer,
            error: false,
            message: `发现新版本 v${latestVer}，点击立即更新`,
          };
        }
        return {
          checking: false,
          downloading: false,
          downloaded: false,
          progress: null,
          version: currentVer,
          error: false,
          message: `当前已是最新版本 (v${currentVer})`,
        };
      }
    } catch (e: any) {
      return {
        checking: false,
        downloading: false,
        downloaded: false,
        progress: null,
        version: null,
        error: true,
        message: "检测更新失败: " + (e?.message || String(e)),
      };
    }
  }

  try {
    return await invoke<UpdateState>("commands_updater_check");
  } catch (e: any) {
    return {
      checking: false,
      downloading: false,
      downloaded: false,
      progress: null,
      version: null,
      error: true,
      message: "检测更新失败: " + (e?.message || String(e)),
    };
  }
}

export async function downloadDesktopUpdate(): Promise<UpdateState> {
  if (!isTauri()) {
    throw new Error("仅支持客户端在线更新");
  }
  return await invoke<UpdateState>("commands_updater_download");
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
