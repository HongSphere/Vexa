import { create } from "zustand";
import {
  AppSettings,
  DanmakuItem,
  DownloadTask,
  EpisodeItem,
  PlatformId,
  SearchResultItem,
  SourcesConfig,
  VideoFormat,
  VideoMetadata,
  WatchHistoryItem,
} from "../types/media";
import {
  actionPlatformWebview,
  fetchDanmaku,
  getSourcesConfig,
  importSourcesJson,
  importSourcesUrl,
  loadLocalSourcesFile,
  parseMediaUrl,
  resetSourcesConfig,
  SAMPLE_DANMAKU,
} from "../services/api";

export type NavTab =
  | "discover"
  | "player"
  | "downloads"
  | "history"
  | "settings";

const STORAGE_SETTINGS_KEY = "vexa_settings_v2";
const STORAGE_HISTORY_KEY = "vexa_history_v1";
const STORAGE_DOWNLOADS_KEY = "vexa_downloads_v1";

const defaultSettings: AppSettings = {
  themeMode: "system",
  downloadDir: "~/Downloads/Vexa",
  preferredQuality: 480,
  danmakuEnabled: true,
  danmakuOpacity: 0.85,
  danmakuArea: "half",
  proxyUrl: "",
  customVodApiUrl: "",
};

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

interface AppState {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;

  activePlatform: PlatformId;
  setActivePlatform: (platform: PlatformId) => void;
  currentWebviewUrl: string;
  setCurrentWebviewUrl: (url: string) => void;
  pendingWebviewNavUrl: string | null;
  navigateWebviewTo: (url: string) => void;
  clearPendingWebviewNavUrl: () => void;

  isParsing: boolean;
  parseError: string | null;
  currentVideo: VideoMetadata | null;
  setCurrentVideo: (v: VideoMetadata | null) => void;
  selectedFormat: VideoFormat | null;
  danmakuList: DanmakuItem[];
  initialSeekTime: number;

  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchResults: SearchResultItem[];
  setSearchResults: (items: SearchResultItem[]) => void;
  isSearching: boolean;
  setIsSearching: (b: boolean) => void;

  downloads: DownloadTask[];
  upsertDownloadTask: (task: DownloadTask) => void;
  removeDownloadTask: (id: string) => void;

  history: WatchHistoryItem[];
  updateWatchProgress: (position: number, duration: number) => void;
  toggleFavorite: (video: {
    id: string;
    url: string;
    title: string;
    uploader: string;
    thumbnail: string;
    platform: any;
    platformName: string;
    duration: number;
  }) => void;
  clearHistory: () => void;
  deleteHistoryItem: (id: string) => void;

  settings: AppSettings;
  updateSettings: (partial: Partial<AppSettings>) => void;
  proxyPort: number;
  setProxyPort: (port: number) => void;
  isMobileFullscreen: boolean;
  setIsMobileFullscreen: (fullscreen: boolean) => void;

  toastMessage: string | null;
  showToast: (msg: string) => void;

  sourcesConfig: SourcesConfig;
  loadSourcesConfig: () => Promise<void>;
  importSources: (jsonStr: string) => Promise<void>;
  importSourcesFromUrl: (url: string) => Promise<void>;
  resetSources: () => Promise<void>;
  loadLocalSources: () => Promise<void>;

  loadAndPlayUrl: (
    url: string,
    startPosition?: number,
    previewItem?: SearchResultItem
  ) => Promise<void>;
  switchResolution: (format: VideoFormat, currentPosition: number) => void;
  switchMediaSource: (sourceId: string) => void;
  switchEpisode: (ep: EpisodeItem) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  activeTab: "discover",
  setActiveTab: (tab) => {
    if (tab !== "discover") {
      actionPlatformWebview("hide").catch(() => {});
    }
    set({ activeTab: tab });
  },

  activePlatform: "all",
  setActivePlatform: (platform) => {
    const sites = get().sourcesConfig.sites;
    const found = sites.find((p) => p.id === platform);
    const home = found ? found.homeUrl : (sites[0]?.homeUrl || "about:blank");
    set({
      activePlatform: platform,
      currentWebviewUrl: home,
      pendingWebviewNavUrl: home,
      activeTab: "discover",
    });
  },
  currentWebviewUrl: "about:blank",
  setCurrentWebviewUrl: (url) => set({ currentWebviewUrl: url }),
  pendingWebviewNavUrl: null,
  navigateWebviewTo: (url) =>
    set({
      currentWebviewUrl: url,
      pendingWebviewNavUrl: url,
      activeTab: "discover",
    }),
  clearPendingWebviewNavUrl: () => set({ pendingWebviewNavUrl: null }),

  sourcesConfig: { sites: [], vodProviders: [], parseLines: [] },
  loadSourcesConfig: async () => {
    try {
      const cfg = await getSourcesConfig();
      set({ sourcesConfig: cfg });
      const currentActive = get().activePlatform;
      if (cfg.sites && cfg.sites.length > 0) {
        if (!cfg.sites.some((s) => s.id === currentActive)) {
          const first = cfg.sites[0];
          set({
            activePlatform: first.id,
            currentWebviewUrl: first.homeUrl,
            pendingWebviewNavUrl: first.homeUrl,
          });
        }
      }
    } catch (e) {
      console.error("加载规则配置失败:", e);
    }
  },
  importSources: async (jsonStr: string) => {
    const cfg = await importSourcesJson(jsonStr);
    set({ sourcesConfig: cfg });
    if (cfg.sites && cfg.sites.length > 0) {
      const first = cfg.sites[0];
      set({
        activePlatform: first.id,
        currentWebviewUrl: first.homeUrl,
        pendingWebviewNavUrl: first.homeUrl,
      });
    }
    get().showToast(
      `成功导入 ${cfg.sites?.length || 0} 个网站，${cfg.vodProviders?.length || 0} 个影视源，${cfg.parseLines?.length || 0} 条解析专线`
    );
  },
  importSourcesFromUrl: async (url: string) => {
    const cfg = await importSourcesUrl(url);
    set({ sourcesConfig: cfg });
    if (cfg.sites && cfg.sites.length > 0) {
      const first = cfg.sites[0];
      set({
        activePlatform: first.id,
        currentWebviewUrl: first.homeUrl,
        pendingWebviewNavUrl: first.homeUrl,
      });
    }
    get().showToast(
      `成功订阅 ${cfg.sites?.length || 0} 个网站，${cfg.vodProviders?.length || 0} 个影视源，${cfg.parseLines?.length || 0} 条解析专线`
    );
  },
  resetSources: async () => {
    await resetSourcesConfig();
    actionPlatformWebview("hide").catch(() => {});
    set({
      sourcesConfig: { sites: [], vodProviders: [], parseLines: [] },
      activePlatform: "generic",
      currentWebviewUrl: "about:blank",
      pendingWebviewNavUrl: "about:blank",
      currentVideo: null,
      selectedFormat: null,
      danmakuList: [],
      initialSeekTime: 0,
      parseError: null,
      isParsing: false,
      searchResults: [],
      searchQuery: "",
    });
    get().showToast("已清空规则配置");
  },
  loadLocalSources: async () => {
    const cfg = await loadLocalSourcesFile();
    set({ sourcesConfig: cfg });
    if (cfg.sites && cfg.sites.length > 0) {
      const first = cfg.sites[0];
      set({
        activePlatform: first.id,
        currentWebviewUrl: first.homeUrl,
        pendingWebviewNavUrl: first.homeUrl,
      });
    }
    get().showToast(
      `已加载本地规则：${cfg.sites?.length || 0} 个网站，${cfg.vodProviders?.length || 0} 个影视源，${cfg.parseLines?.length || 0} 条解析专线`
    );
  },

  isParsing: false,
  parseError: null,
  currentVideo: null,
  setCurrentVideo: (v) => set({ currentVideo: v }),
  selectedFormat: null,
  danmakuList: SAMPLE_DANMAKU,
  initialSeekTime: 0,

  searchQuery: "",
  setSearchQuery: (q) => set({ searchQuery: q }),
  searchResults: [],
  setSearchResults: (items) => set({ searchResults: items }),
  isSearching: false,
  setIsSearching: (b) => set({ isSearching: b }),

  downloads: readStorage<DownloadTask[]>(STORAGE_DOWNLOADS_KEY, []),
  upsertDownloadTask: (task) =>
    set((state) => {
      const idx = state.downloads.findIndex((d) => d.id === task.id);
      const next =
        idx >= 0
          ? state.downloads.map((d, i) => (i === idx ? task : d))
          : [task, ...state.downloads];
      writeStorage(STORAGE_DOWNLOADS_KEY, next);
      return { downloads: next };
    }),
  removeDownloadTask: (id) =>
    set((state) => {
      const next = state.downloads.filter((d) => d.id !== id);
      writeStorage(STORAGE_DOWNLOADS_KEY, next);
      return { downloads: next };
    }),

  history: readStorage<WatchHistoryItem[]>(STORAGE_HISTORY_KEY, []),
  updateWatchProgress: (position, duration) => {
    const { currentVideo, selectedFormat, history } = get();
    if (!currentVideo || position < 1) return;
    const existing = history.find(
      (h) => h.url === currentVideo.url || h.id === currentVideo.id
    );
    const item: WatchHistoryItem = {
      id: currentVideo.id,
      url: currentVideo.url,
      title: currentVideo.title,
      uploader: currentVideo.uploader,
      thumbnail: currentVideo.thumbnail,
      platform: currentVideo.platform,
      platformName: currentVideo.platformName,
      lastPosition: Math.floor(position),
      duration: Math.floor(duration || currentVideo.duration || 0),
      qualityLabel: selectedFormat?.qualityLabel,
      watchedAt: Date.now(),
      isFavorite: existing?.isFavorite ?? false,
    };
    const filtered = history.filter(
      (h) => h.url !== currentVideo.url && h.id !== currentVideo.id
    );
    const next = [item, ...filtered].slice(0, 100);
    writeStorage(STORAGE_HISTORY_KEY, next);
    set({ history: next });
  },
  toggleFavorite: (video) =>
    set((state) => {
      const existing = state.history.find(
        (h) => h.url === video.url || h.id === video.id
      );
      const next = existing
        ? state.history.map((h) =>
            h.url === video.url || h.id === video.id
              ? { ...h, isFavorite: !h.isFavorite }
              : h
          )
        : [
            {
              ...video,
              lastPosition: 0,
              watchedAt: Date.now(),
              isFavorite: true,
            },
            ...state.history,
          ];
      writeStorage(STORAGE_HISTORY_KEY, next);
      return { history: next };
    }),
  clearHistory: () => {
    try {
      localStorage.removeItem(STORAGE_HISTORY_KEY);
    } catch {}
    set({ history: [] });
  },
  deleteHistoryItem: (id) =>
    set((state) => {
      const next = state.history.filter((h) => h.id !== id);
      writeStorage(STORAGE_HISTORY_KEY, next);
      return { history: next };
    }),

  settings: {
    ...defaultSettings,
    ...readStorage<Partial<AppSettings>>(STORAGE_SETTINGS_KEY, {}),
  },
  updateSettings: (partial) =>
    set((state) => {
      const next = { ...state.settings, ...partial };
      writeStorage(STORAGE_SETTINGS_KEY, next);
      return { settings: next };
    }),
  proxyPort: 19527,
  setProxyPort: (port) => set({ proxyPort: port }),
  isMobileFullscreen: false,
  setIsMobileFullscreen: (fullscreen) => set({ isMobileFullscreen: fullscreen }),

  toastMessage: null,
  showToast: (msg) => {
    set({ toastMessage: msg });
    setTimeout(() => {
      if (get().toastMessage === msg) {
        set({ toastMessage: null });
      }
    }, 3200);
  },

  loadAndPlayUrl: async (rawInput, startPosition, previewItem) => {
    const trimmed = rawInput.trim();
    if (!trimmed) return;
    const { settings, history, showToast } = get();

    // Hide embedded official platform webview immediately when switching to player
    actionPlatformWebview("hide").catch(() => {});

    const savedHistory = history.find((h) => h.url === trimmed);
    const resumePos =
      startPosition !== undefined
        ? startPosition
        : savedHistory && savedHistory.lastPosition > 5
        ? savedHistory.lastPosition
        : 0;

    set({
      isParsing: true,
      parseError: null,
      activeTab: "player",
      selectedFormat: null,
    });

    try {
      const metadata = await parseMediaUrl(trimmed, settings.proxyUrl);
      const finalMetadata: VideoMetadata = previewItem
        ? {
            ...metadata,
            platform: previewItem.platform,
            platformName: previewItem.platformName,
          }
        : metadata;

      const sortedFormats = [...(finalMetadata.formats || [])].sort(
        (a, b) => b.height - a.height
      );

      // Prefer non-DASH progressive MP4 when matching preferredQuality (e.g. 480P) for instant single-stream playback
      const preferred =
        sortedFormats.find(
          (f) => !f.isDash && f.height <= settings.preferredQuality
        ) ||
        sortedFormats.find((f) => f.height <= settings.preferredQuality) ||
        sortedFormats.find((f) => !f.isDash) ||
        sortedFormats[sortedFormats.length - 1] ||
        sortedFormats[0] ||
        null;

      // 激活播放线路规则（遵循原生优先与纯净流优先守则）：
      // 1. 若存在纯净直链媒体流 (m3u8)，优先激活原生播放器，杜绝第三方 iframe 恶俗广告
      // 2. 若为官方原视频流直连 (sourceType === "native")，激活官方原画视频流
      // 3. 若均无，才回退至解析专线或官方原网页
      const firstM3u8 = finalMetadata.sources?.find(
        (s) => s.sourceType === "m3u8"
      );
      const nativeSource = finalMetadata.sources?.find(
        (s) => s.sourceType === "native"
      );
      const firstJx = finalMetadata.sources?.find(
        (s) => s.sourceType === "jx_iframe"
      );

      if (firstM3u8) {
        finalMetadata.activeSourceId = firstM3u8.sourceId;
      } else if (nativeSource) {
        finalMetadata.activeSourceId = nativeSource.sourceId;
      } else if (firstJx) {
        finalMetadata.activeSourceId = firstJx.sourceId;
      } else {
        finalMetadata.activeSourceId =
          finalMetadata.sources?.[0]?.sourceId || "official-native";
      }

      const activeSrc = finalMetadata.sources?.find(
        (s) => s.sourceId === finalMetadata.activeSourceId
      );
      const chosenFormat =
        preferred || (activeSrc?.formats && activeSrc.formats[0]) || null;

      set({
        currentVideo: finalMetadata,
        selectedFormat: chosenFormat,
        initialSeekTime: resumePos,
        isParsing: false,
      });

      const sourceCount = finalMetadata.sources?.length || 0;
      if (resumePos > 5) {
        const mins = Math.floor(resumePos / 60);
        const secs = Math.floor(resumePos % 60)
          .toString()
          .padStart(2, "0");
        showToast(`已恢复观看进度 ${mins}:${secs}`);
      } else if ((finalMetadata.formats?.length || 0) > 0) {
        showToast(`已解析直连：${finalMetadata.title}`);
      } else if (firstM3u8) {
        showToast(`已就绪：推荐纯净线路【${firstM3u8.sourceName}】`);
      } else if (firstJx) {
        showToast(`已激活线路【${firstJx.sourceName}】`);
      } else if (sourceCount > 1) {
        showToast(`已就绪：匹配到 ${sourceCount} 条线路`);
      } else {
        showToast(`正在播放：${preferred?.qualityLabel || "高清画质"}`);
      }

      if (finalMetadata.cid) {
        fetchDanmaku(finalMetadata.cid).then((dm) => {
          set({ danmakuList: dm });
        });
      } else {
        set({ danmakuList: SAMPLE_DANMAKU });
      }
    } catch (err: any) {
      const errMsg =
        typeof err === "string"
          ? err
          : err?.message || "解析视频失败，请检查链接或网络设置";
      set({
        isParsing: false,
        parseError: errMsg,
      });
      showToast(`解析提示：${errMsg}`);
    }
  },

  switchResolution: (format, currentPosition) => {
    const { showToast } = get();
    set({
      selectedFormat: format,
      initialSeekTime: currentPosition,
    });
    showToast(`已切换至 ${format.qualityLabel}`);
  },

  switchMediaSource: (sourceId) => {
    const { currentVideo, showToast } = get();
    if (!currentVideo || !currentVideo.sources) return;
    const target = currentVideo.sources.find((s) => s.sourceId === sourceId);
    if (!target) return;

    if (target.sourceType === "m3u8") {
      const epCount = target.episodes?.length || 0;
      const epIdx =
        currentVideo.currentEpisodeIndex >= 1 &&
        currentVideo.currentEpisodeIndex <= epCount
          ? currentVideo.currentEpisodeIndex
          : 1;
      const chosenEp =
        (target.episodes && (target.episodes[epIdx - 1] || target.episodes[0])) ||
        null;
      const playUrl = chosenEp ? chosenEp.url : target.playUrl;

      const nextFormat: VideoFormat = {
        formatId: `${target.sourceId}-1080p`,
        qualityLabel: "1080P 高清",
        height: 1080,
        fps: 30,
        ext: "m3u8",
        vcodec: "h264",
        acodec: "aac",
        videoUrl: playUrl,
        isDash: false,
        isHls: true,
        headers: {},
      };

      set({
        currentVideo: {
          ...currentVideo,
          activeSourceId: target.sourceId,
          episodes:
            (target.episodes?.length || 0) > 0
              ? target.episodes
              : currentVideo.episodes || [],
          currentEpisodeIndex: epIdx,
        },
        selectedFormat: nextFormat,
        initialSeekTime: 0,
      });
      showToast(`已切换至「${target.sourceName}」`);
    } else if (target.sourceType === "native" || target.sourceType === "mp4") {
      const { settings } = get();
      if (target.formats && target.formats.length > 0) {
        const sorted = [...(target.formats || [])].sort((a, b) => b.height - a.height);
        const preferred =
          sorted.find(
            (f) => !f.isDash && f.height <= settings.preferredQuality
          ) ||
          sorted.find((f) => f.height <= settings.preferredQuality) ||
          sorted.find((f) => !f.isDash) ||
          sorted[sorted.length - 1] ||
          sorted[0];

        set({
          currentVideo: {
            ...currentVideo,
            activeSourceId: target.sourceId,
            formats: target.formats,
            episodes:
              (target.episodes?.length || 0) > 0
                ? target.episodes
                : currentVideo.episodes || [],
          },
          selectedFormat: preferred,
          initialSeekTime: 0,
        });
        showToast(`已切换至「${target.sourceName}」`);
        return;
      }

      // On-demand original video parsing (officialOnly = true)
      showToast(`正在使用官方线路解析原视频流...`);
      parseMediaUrl(target.playUrl, settings.proxyUrl, true)
        .then((origMeta) => {
          const latest = get().currentVideo;
          if (!latest) return;
          const sorted = [...(origMeta.formats || [])].sort(
            (a, b) => b.height - a.height
          );
          const preferred =
            sorted.find(
              (f) => !f.isDash && f.height <= settings.preferredQuality
            ) ||
            sorted.find((f) => f.height <= settings.preferredQuality) ||
            sorted.find((f) => !f.isDash) ||
            sorted[sorted.length - 1] ||
            sorted[0] ||
            null;

          const updatedSources = (latest.sources || []).map((s) =>
            s.sourceId === target.sourceId
              ? {
                  ...s,
                  formats: origMeta.formats || [],
                  episodes:
                    (origMeta.episodes?.length || 0) > 0
                      ? origMeta.episodes
                      : s.episodes || [],
                  remarks: "原视频流已就绪",
                }
              : s
          );

          set({
            currentVideo: {
              ...latest,
              activeSourceId: target.sourceId,
              formats: origMeta.formats || [],
              episodes:
                (origMeta.episodes?.length || 0) > 0
                  ? origMeta.episodes
                  : latest.episodes || [],
              sources: updatedSources,
            },
            selectedFormat: preferred,
            initialSeekTime: 0,
          });
          showToast(
            `已切换至「${target.sourceName}」（${
              preferred?.qualityLabel || "原画"
            }）`
          );
        })
        .catch((_err: any) => {
          const latest = get().currentVideo;
          if (!latest) return;
          const parsePrefix =
            get().sourcesConfig.parseLines?.[0]?.urlPrefix || "";
          const updatedSources = (latest.sources || []).map((s) =>
            s.sourceId === target.sourceId
              ? {
                  ...s,
                  sourceType: "jx_iframe",
                  playUrl: parsePrefix
                    ? `${parsePrefix}${encodeURIComponent(s.playUrl)}`
                    : s.playUrl,
                }
              : s
          );
          set({
            currentVideo: {
              ...latest,
              activeSourceId: target.sourceId,
              sources: updatedSources,
            },
          });
          showToast(`已切换至「${target.sourceName}」`);
        });
    } else {
      // jx_iframe parse line
      set({
        currentVideo: {
          ...currentVideo,
          activeSourceId: target.sourceId,
        },
      });
      showToast(`已切换至「${target.sourceName}」`);
    }
  },

  switchEpisode: async (ep) => {
    const { currentVideo, selectedFormat, loadAndPlayUrl, showToast } = get();
    if (!currentVideo) return;

    if (ep.url.includes(".m3u8") || ep.url.includes(".mp4")) {
      const nextFormat: VideoFormat = {
        ...(selectedFormat || {
          formatId: "m3u8-1080p",
          qualityLabel: "1080P 高清",
          height: 1080,
          fps: 30,
          ext: "m3u8",
          vcodec: "h264",
          acodec: "aac",
          isDash: false,
          isHls: true,
          headers: {},
        }),
        videoUrl: ep.url,
        isHls: ep.url.includes(".m3u8"),
        isDash: false,
      };

      // 若当前处于解析iframe或官方原网页，切换选集时自动切入聚合直链原生播放器
      let nextActiveSourceId = currentVideo.activeSourceId;
      const currentActive = currentVideo.sources?.find(
        (s) => s.sourceId === currentVideo.activeSourceId
      );
      if (
        !currentActive ||
        currentActive.sourceType === "jx_iframe" ||
        currentActive.sourceType === "official_web"
      ) {
        const m3u8Source = currentVideo.sources?.find(
          (s) => s.sourceType === "m3u8"
        );
        if (m3u8Source) {
          nextActiveSourceId = m3u8Source.sourceId;
        }
      }

      set({
        currentVideo: {
          ...currentVideo,
          activeSourceId: nextActiveSourceId,
          currentEpisodeIndex: ep.index,
        },
        selectedFormat: nextFormat,
        initialSeekTime: 0,
      });
      showToast(`正在播放：${ep.title}`);
      return;
    }

    await loadAndPlayUrl(ep.url, 0);
  },
}));
