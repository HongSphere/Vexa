import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Download,
  Heart,
  PlayCircle,
  Sparkles,
  Check,
  Loader2,
  Zap,
  Globe,
  Share2,
  Search,
  Clipboard,
  X,
  Maximize,
  Minimize,
  RefreshCw,
  Volume2,
  Sun,
  FastForward,
  Rewind,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { MobileVideoPlayer } from "../components/MobileVideoPlayer";
import { formatDuration } from "../../utils/format";
import { startDownloadTask, setAppFullscreen } from "../../services/api";
import { VideoFormat } from "../../types/media";


export const MobilePlayerView: React.FC = () => {
  const {
    currentVideo,
    selectedFormat,
    danmakuList,
    initialSeekTime,
    isParsing,
    parseError,
    loadAndPlayUrl,
    switchMediaSource,
    switchEpisode,
    history,
    toggleFavorite,
    settings,
    upsertDownloadTask,
    showToast,
    setActiveTab,
    proxyPort,
    isMobileFullscreen,
    setIsMobileFullscreen,
    sourcesConfig,
  } = useAppStore();

  const episodeCount = currentVideo?.episodes?.length || 0;
  const sourcesList = currentVideo?.sources || [];
  const activeSource = sourcesList.find(
    (s) => s.sourceId === currentVideo?.activeSourceId
  );
  const firstM3u8 = sourcesList.find((s) => s.sourceType === "m3u8");
  const isIframe =
    activeSource?.sourceType === "jx_iframe" ||
    activeSource?.sourceType === "official_web";

  const [activeSubTab, setActiveSubTab] = useState<"episodes" | "sources" | "info">("sources");
  const [sourceFilter, setSourceFilter] = useState<"all" | "m3u8" | "jx" | "official">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [isIframeFullscreen, setIsIframeFullscreen] = useState(false);
  const [isIframeLoading, setIsIframeLoading] = useState(false);
  const [iframeReloadKey, setIframeReloadKey] = useState(0);
  const [sniffedStreamUrl, setSniffedStreamUrl] = useState("");
  const [useNativeForSniffed, setUseNativeForSniffed] = useState(false);
  const [showFsControls, setShowFsControls] = useState(true);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [iframeBrightness, setIframeBrightness] = useState(1);
  const [iframeVolume, setIframeVolume] = useState(1);
  const [gestureHud, setGestureHud] = useState<{
    icon: "sun" | "volume" | "forward" | "rewind";
    text: string;
  } | null>(null);
  const hudTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fsControlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStateRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    startBrightness: number;
    startVolume: number;
    mode: "none" | "seek" | "volume" | "brightness";
    deltaSec: number;
    lastTapTime: number;
    lastTapX: number;
  }>({
    startX: 0,
    startY: 0,
    startTime: 0,
    startBrightness: 1,
    startVolume: 1,
    mode: "none",
    deltaSec: 0,
    lastTapTime: 0,
    lastTapX: 0,
  });

  const triggerControlsVisibility = () => {
    setShowFsControls(true);
    if (fsControlsTimerRef.current) clearTimeout(fsControlsTimerRef.current);
    fsControlsTimerRef.current = setTimeout(() => {
      setShowFsControls(false);
    }, 3200);
  };

  const showHud = (icon: "sun" | "volume" | "forward" | "rewind", text: string) => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    setGestureHud({ icon, text });
    hudTimerRef.current = setTimeout(() => {
      setGestureHud(null);
    }, 800);
  };

  const handleIframeTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const now = Date.now();
    const rect = e.currentTarget.getBoundingClientRect();
    const x = touch.clientX - rect.left;
    const isLeftHalf = x < rect.width / 2;

    triggerControlsVisibility();

    if (now - touchStateRef.current.lastTapTime < 320 && Math.abs(x - touchStateRef.current.lastTapX) < 80) {
      const step = isLeftHalf ? -10 : 10;
      iframeRef.current?.contentWindow?.postMessage({ type: "VEXA_SEEK_RELATIVE", seconds: step }, "*");
      showHud(step > 0 ? "forward" : "rewind", `${step > 0 ? "快进" : "快退"} ${Math.abs(step)}s`);
      touchStateRef.current.lastTapTime = 0;
      return;
    }

    touchStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: now,
      startBrightness: iframeBrightness,
      startVolume: iframeVolume,
      mode: "none",
      deltaSec: 0,
      lastTapTime: now,
      lastTapX: x,
    };
  };

  const handleIframeTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const st = touchStateRef.current;
    const dx = touch.clientX - st.startX;
    const dy = touch.clientY - st.startY;
    const rect = e.currentTarget.getBoundingClientRect();
    const isLeftHalf = st.startX - rect.left < rect.width / 2;

    if (st.mode === "none") {
      if (Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy)) {
        st.mode = "seek";
      } else if (Math.abs(dy) > 18 && Math.abs(dy) > Math.abs(dx)) {
        st.mode = isLeftHalf ? "brightness" : "volume";
      }
    }

    if (st.mode === "seek") {
      const delta = Math.round(dx / 12) * 5;
      st.deltaSec = delta;
      showHud(delta >= 0 ? "forward" : "rewind", `${delta >= 0 ? "快进" : "快退"} ${Math.abs(delta)}s`);
    } else if (st.mode === "brightness") {
      const newB = Math.max(0.3, Math.min(1.5, st.startBrightness - dy / 180));
      setIframeBrightness(newB);
      showHud("sun", `亮度 ${Math.round((newB / 1.5) * 100)}%`);
    } else if (st.mode === "volume") {
      const newV = Math.max(0, Math.min(1, st.startVolume - dy / 180));
      setIframeVolume(newV);
      iframeRef.current?.contentWindow?.postMessage({ type: "VEXA_SET_VOLUME", delta: -dy / 1800 }, "*");
      showHud("volume", `音量 ${Math.round(newV * 100)}%`);
    }
  };

  const handleIframeTouchEnd = () => {
    const st = touchStateRef.current;
    if (st.mode === "seek" && st.deltaSec !== 0) {
      iframeRef.current?.contentWindow?.postMessage({ type: "VEXA_SEEK_RELATIVE", seconds: st.deltaSec }, "*");
    }
    st.mode = "none";
    st.deltaSec = 0;
  };

  const iframeSrc = useMemo(() => {
    if (!activeSource?.playUrl) return "";
    if (activeSource.sourceType === "official_web" && proxyPort) {
      return `http://127.0.0.1:${proxyPort}/web?url=${encodeURIComponent(activeSource.playUrl)}&ua=mobile&shield=true`;
    }
    if (activeSource.sourceType === "jx_iframe" && proxyPort) {
      const lineCfg = sourcesConfig.parseLines?.find(
        (l) => activeSource.playUrl.startsWith(l.urlPrefix) || l.id === activeSource.sourceId
      );
      const ua = lineCfg?.ua || "desktop";
      const baseRules = ["o.js", "trafficmanager", "union", "adbyunion", "popunder"];
      const blockRules = Array.from(new Set([...(lineCfg?.blockRules || []), ...baseRules]));
      const blockQuery = `&block=${encodeURIComponent(blockRules.join(","))}`;
      return `http://127.0.0.1:${proxyPort}/web?url=${encodeURIComponent(activeSource.playUrl)}&ua=${encodeURIComponent(ua)}&shield=true${blockQuery}`;
    }
    return activeSource.playUrl;
  }, [activeSource, proxyPort, sourcesConfig]);

  useEffect(() => {
    setSniffedStreamUrl("");
    setUseNativeForSniffed(false);
    if (isIframe && iframeSrc) {
      setIsIframeLoading(true);
      const timer = setTimeout(() => setIsIframeLoading(false), 3800);
      return () => clearTimeout(timer);
    } else {
      setIsIframeLoading(false);
    }
  }, [iframeSrc, isIframe, iframeReloadKey]);

  const enterIframeFullscreen = async () => {
    setIsIframeFullscreen(true);
    setIsMobileFullscreen(true);
    setShowFsControls(true);
    await setAppFullscreen(true);
    try {
      if (window.screen.orientation && "lock" in window.screen.orientation) {
        await (window.screen.orientation as any).lock("landscape").catch(() => {});
      }
    } catch {}
  };

  const exitIframeFullscreen = async () => {
    setIsIframeFullscreen(false);
    setIsMobileFullscreen(false);
    setShowFsControls(true);
    await setAppFullscreen(false);
    try {
      if (window.screen.orientation && "unlock" in window.screen.orientation) {
        (window.screen.orientation as any).unlock();
      }
    } catch {}
  };

  useEffect(() => {
    if (!isIframeFullscreen) {
      setShowFsControls(true);
      return;
    }
    const timer = setTimeout(() => setShowFsControls(false), 3500);
    return () => clearTimeout(timer);
  }, [isIframeFullscreen, showFsControls]);

  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (!e.data || typeof e.data !== "object") return;
      if (e.data.type === "VEXA_IFRAME_READY") {
        setIsIframeLoading(false);
      } else if (e.data.type === "VEXA_IFRAME_FULLSCREEN_TOGGLE") {
        if (isIframeFullscreen) {
          exitIframeFullscreen();
        } else {
          enterIframeFullscreen();
        }
      } else if (
        e.data.type === "VEXA_SNIFFED_STREAM" &&
        typeof e.data.url === "string" &&
        e.data.url.startsWith("http")
      ) {
        setIsIframeLoading(false);
        setSniffedStreamUrl((prev) => prev || e.data.url);
        setUseNativeForSniffed(true);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isIframeFullscreen]);

  const sniffedFormat: VideoFormat | null = useMemo(() => {
    if (!sniffedStreamUrl) return null;
    return {
      formatId: "sniffed-hls",
      qualityLabel: `${activeSource?.sourceName || "解析"} · 直连流`,
      height: 1080,
      fps: 30,
      ext: "m3u8",
      vcodec: "h264",
      acodec: "aac",
      videoUrl: sniffedStreamUrl,
      isDash: false,
      isHls: true,
      headers: {},
    };
  }, [sniffedStreamUrl, activeSource?.sourceName]);

  const cycleNextParseLine = () => {
    const jxList = sourcesList.filter((s) => s.sourceType === "jx_iframe");
    if (jxList.length <= 1) {
      setIframeReloadKey((k) => k + 1);
      showToast("正在重新加载当前线路...");
      return;
    }
    const idx = jxList.findIndex((s) => s.sourceId === activeSource?.sourceId);
    const next = jxList[(idx + 1) % jxList.length];
    if (next) {
      switchMediaSource(next.sourceId);
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      if (!document.fullscreenElement && isIframeFullscreen) {
        setIsIframeFullscreen(false);
        setIsMobileFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    document.addEventListener("webkitfullscreenchange", handleFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
      document.removeEventListener("webkitfullscreenchange", handleFsChange);
    };
  }, [isIframeFullscreen, setIsMobileFullscreen]);

  useEffect(() => {
    return () => {
      setIsMobileFullscreen(false);
      try {
        (window.screen.orientation as any)?.unlock?.();
      } catch {}
    };
  }, [setIsMobileFullscreen]);

  const iframeContainerStyle: React.CSSProperties = useMemo(() => {
    const base: React.CSSProperties = {
      filter: `brightness(${iframeBrightness})`,
    };
    if (!isIframeFullscreen) return base;
    return {
      ...base,
      position: "fixed",
      inset: 0,
      width: "100vw",
      height: "100vh",
      zIndex: 99999,
      backgroundColor: "#000000",
    };
  }, [isIframeFullscreen, iframeBrightness]);

  // Default active tab based on episode count
  useEffect(() => {
    if (currentVideo) {
      if ((currentVideo.episodes?.length || 0) > 1) {
        setActiveSubTab("episodes");
      } else {
        setActiveSubTab("sources");
      }
    }
  }, [currentVideo?.id]);

  const isFavorite = currentVideo
    ? history.some((h) => h.id === currentVideo.id && h.isFavorite)
    : false;

  const handleSearch = async (kw?: string) => {
    const q = (kw ?? searchQuery).trim();
    if (!q) {
      showToast("请输入片名或粘贴视频链接");
      return;
    }
    await loadAndPlayUrl(q);
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (!text || !text.trim()) {
        showToast("剪贴板中无内容");
        return;
      }
      setSearchQuery(text.trim());
      await handleSearch(text.trim());
    } catch {
      showToast("请长按输入框直接粘贴");
    }
  };

  const handleCopyLink = () => {
    if (!currentVideo?.url) return;
    navigator.clipboard?.writeText(currentVideo.url);
    showToast("已复制视频链接");
  };

  const handleDownload = async () => {
    if (!currentVideo) return;
    const chosenFmt = selectedFormat || currentVideo.formats?.[0];
    const streamUrl = chosenFmt?.videoUrl || currentVideo.url;

    try {
      showToast("正在创建下载任务...");
      const task = await startDownloadTask({
        url: streamUrl,
        title: currentVideo.title,
        thumbnail: currentVideo.thumbnail,
        platformName: currentVideo.platformName,
        formatId: chosenFmt?.formatId || "best",
        qualityLabel: chosenFmt?.qualityLabel || "高清画质",
        height: chosenFmt?.height || 1080,
        audioOnly: false,
        downloadDir: settings.downloadDir,
        proxyUrl: settings.proxyUrl,
      });
      upsertDownloadTask(task);
      showToast(`已加入下载队列: ${currentVideo.title}`);
    } catch (e: any) {
      showToast("下载失败: " + (e?.message || String(e)));
    }
  };

  if (isParsing) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-8 text-center select-none bg-slate-50 dark:bg-[#07090e]">
        <div className="w-12 h-12 rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-500 mb-3">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 mb-1">正在检索全网媒体流...</h3>
        <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs">
          正在智能聚合解析该视频的高清画质与线路切片
        </p>
      </div>
    );
  }

  if (!currentVideo) {
    return (
      <div className="h-full overflow-y-auto p-5 flex flex-col justify-center select-none space-y-6 bg-slate-50 dark:bg-[#07090e]">
        <div className="text-center space-y-2">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-500 mb-2 shadow-sm">
            <PlayCircle className="w-7 h-7" />
          </div>
          <h2 className="text-base font-bold text-slate-900 dark:text-white">全能多媒体播放器</h2>
          <p className="text-xs text-slate-400 dark:text-slate-500 max-w-xs mx-auto leading-relaxed">
            输入片名或粘贴视频链接，原生引擎毫秒级秒播
          </p>
        </div>

        {/* Search Bar Capsule with Paste & Action */}
        <div className="space-y-4 max-w-sm mx-auto w-full">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSearch()}
              placeholder="输入片名 / 粘贴视频链接..."
              className="w-full pl-10 pr-24 py-2.5 bg-white dark:bg-[#0e121a] border border-black/[0.08] dark:border-white/[0.09] text-xs rounded-full focus:outline-none focus:border-sky-500 shadow-sm transition-all"
            />
            <div className="absolute right-1.5 flex items-center gap-1">
              <button
                onClick={handlePasteClipboard}
                className="p-1.5 text-slate-400 hover:text-sky-500 active:scale-90 transition-transform"
                title="读取剪贴板"
              >
                <Clipboard className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleSearch()}
                className="px-3 py-1 rounded-full bg-sky-500 active:bg-sky-600 text-white text-xs font-semibold shadow-sm active:scale-95 transition-all"
              >
                解析
              </button>
            </div>
          </div>

          {/* Recent history or neutral hint */}
          {history.length > 0 ? (
            <div className="space-y-2 pt-1">
              <span className="text-[11px] font-semibold text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-sky-500" />
                <span>最近播放记录</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {history.slice(0, 6).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => loadAndPlayUrl(item.url)}
                    className="px-2.5 py-1 rounded-full bg-white dark:bg-[#0e121a] border border-black/[0.06] dark:border-white/[0.08] text-xs text-slate-600 dark:text-slate-300 hover:text-sky-500 active:scale-95 transition-transform max-w-[140px] truncate"
                    title={item.title}
                  >
                    {item.title}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="pt-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
              <span>支持输入 HLS (.m3u8)、MP4 直链或网络媒体网址起播</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-[#07090e]">
      {/* Top Video Canvas */}
      <div
        className={
          isIframeFullscreen || isMobileFullscreen
            ? "fixed inset-0 z-[99999] bg-black"
            : "w-full aspect-video bg-black shrink-0 relative overflow-hidden z-10 shadow-sm"
        }
      >
        {isIframe && !(useNativeForSniffed && sniffedFormat) ? (
          <div
            style={iframeContainerStyle}
            onTouchStart={handleIframeTouchStart}
            onTouchMove={handleIframeTouchMove}
            onTouchEnd={handleIframeTouchEnd}
            onClick={triggerControlsVisibility}
            className={`w-full h-full bg-black relative ${
              isIframeFullscreen ? "!w-full !h-full" : ""
            }`}
          >
            <iframe
              ref={iframeRef}
              key={`${iframeSrc}-${iframeReloadKey}`}
              src={iframeSrc}
              title={activeSource?.sourceName || "播放器"}
              onLoad={() => setIsIframeLoading(false)}
              className="w-full h-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
              allowFullScreen
              sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
            />
            {gestureHud && (
              <div className="absolute inset-0 z-40 flex items-center justify-center pointer-events-none">
                <div className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-black/85 backdrop-blur-md border border-white/15 text-white shadow-2xl text-sm font-bold tracking-wide">
                  {gestureHud.icon === "sun" && <Sun className="w-5 h-5 text-amber-400" />}
                  {gestureHud.icon === "volume" && <Volume2 className="w-5 h-5 text-sky-400" />}
                  {gestureHud.icon === "forward" && <FastForward className="w-5 h-5 text-emerald-400" />}
                  {gestureHud.icon === "rewind" && <Rewind className="w-5 h-5 text-amber-400" />}
                  <span>{gestureHud.text}</span>
                </div>
              </div>
            )}
            {isIframeLoading && (
              <div className="absolute inset-0 z-10 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center gap-2.5 px-4 text-center pointer-events-none">
                <Loader2 className="w-6 h-6 text-sky-400 animate-spin" />
                <div className="text-xs font-semibold text-white">
                  正在连接「{activeSource?.sourceName || "解析专线"}」...
                </div>
                <button
                  onClick={cycleNextParseLine}
                  className="pointer-events-auto mt-1 px-3 py-1 rounded-full bg-white/10 hover:bg-white/20 border border-white/20 text-[11px] text-slate-200 font-medium active:scale-95 transition-all"
                >
                  切换下一条解析线路
                </button>
              </div>
            )}
            {isIframeFullscreen ? (
              <div
                style={{
                  top: "max(env(safe-area-inset-top, 0px), 12px)",
                  left: "max(env(safe-area-inset-left, 0px), 12px)",
                  right: "max(env(safe-area-inset-right, 0px), 12px)",
                }}
                className={`absolute z-50 flex items-center justify-between pointer-events-none transition-opacity duration-300 ${
                  showFsControls ? "opacity-100" : "opacity-0"
                }`}
              >
                <button
                  id="vx-iframe-exit-fs-btn"
                  onClick={exitIframeFullscreen}
                  className="pointer-events-auto px-3 py-1.5 rounded-full bg-black/80 backdrop-blur-md border border-white/20 text-white text-xs font-semibold flex items-center gap-1.5 shadow-xl active:scale-95 transition-all"
                >
                  <Minimize className="w-3.5 h-3.5" />
                  <span>退出全屏</span>
                </button>
                <div className="flex items-center gap-1.5 pointer-events-auto">
                  {sniffedFormat && (
                    <button
                      onClick={() => {
                        exitIframeFullscreen();
                        setUseNativeForSniffed(true);
                        showToast("已切换至原生手势播放器");
                      }}
                      className="px-2.5 py-1.5 rounded-full bg-emerald-500/90 backdrop-blur-md border border-emerald-300/30 text-white text-xs font-semibold flex items-center gap-1 shadow-xl active:scale-95 transition-all"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>原生手势播</span>
                    </button>
                  )}
                  <button
                    onClick={cycleNextParseLine}
                    className="px-2.5 py-1.5 rounded-full bg-black/80 backdrop-blur-md border border-white/20 text-white text-xs font-semibold flex items-center gap-1 shadow-xl active:scale-95 transition-all"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>换线</span>
                  </button>
                </div>
              </div>
            ) : (
              <div
                className={`absolute top-2 right-2 z-20 flex items-center gap-1.5 transition-opacity duration-300 ${
                  showFsControls ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
                }`}
              >
                <button
                  onClick={() => {
                    setIframeReloadKey((k) => k + 1);
                    showToast("正在重新加载当前线路...");
                  }}
                  className="px-2 py-1 rounded-full bg-black/70 backdrop-blur-md border border-white/15 text-white/90 text-[11px] font-medium flex items-center gap-1 shadow-md active:scale-95 transition-all"
                  title="刷新线路"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>刷新</span>
                </button>
                <button
                  onClick={cycleNextParseLine}
                  className="px-2 py-1 rounded-full bg-black/70 backdrop-blur-md border border-white/15 text-white/90 text-[11px] font-medium flex items-center gap-1 shadow-md active:scale-95 transition-all"
                  title="切换下一条解析线路"
                >
                  <span>换线</span>
                </button>
                <button
                  onClick={enterIframeFullscreen}
                  className="px-2.5 py-1 rounded-full bg-sky-500/90 backdrop-blur-md border border-sky-300/30 text-white text-[11px] font-semibold flex items-center gap-1 shadow-md active:scale-95 transition-all"
                >
                  <Maximize className="w-3 h-3" />
                  <span>全屏</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          <MobileVideoPlayer
            video={currentVideo}
            format={useNativeForSniffed && sniffedFormat ? sniffedFormat : selectedFormat}
            danmakuList={danmakuList}
            initialSeekTime={initialSeekTime}
            onOpenDownloadModal={handleDownload}
            onBack={() => setActiveTab("discover")}
          />
        )}
      </div>

      {parseError && (
        <div className="px-3 py-1.5 bg-amber-500/15 border-b border-amber-500/30 text-amber-500 text-xs flex items-center justify-between">
          <span>{parseError}</span>
          <button
            onClick={() => setActiveTab("discover")}
            className="text-[11px] underline font-semibold"
          >
            返回
          </button>
        </div>
      )}

      {isIframe && sniffedFormat && (
        <div className="px-3.5 py-1.5 bg-emerald-500/10 border-b border-emerald-500/20 text-emerald-600 dark:text-emerald-400 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 min-w-0 pr-2">
            <Sparkles className="w-3.5 h-3.5 shrink-0 text-emerald-500" />
            <span className="truncate text-[11px] font-medium">
              {useNativeForSniffed
                ? `已启用原生手势播放器（${activeSource?.sourceName}）`
                : `已捕获【${activeSource?.sourceName}】直连流，可享手势倍速与全屏`}
            </span>
          </div>
          <button
            onClick={() => {
              setUseNativeForSniffed((v) => !v);
              showToast(
                useNativeForSniffed ? "已切回网页内嵌模式" : "已切换至原生手势播放器"
              );
            }}
            className="px-2.5 py-0.5 rounded-full bg-emerald-500 active:bg-emerald-600 text-white font-semibold text-[11px] shrink-0 active:scale-95 shadow-sm"
          >
            {useNativeForSniffed ? "切回网页模式" : "切换原生播放"}
          </button>
        </div>
      )}

      {isIframe && !sniffedFormat && firstM3u8 && (
        <div className="px-3.5 py-1.5 bg-sky-500/10 border-b border-sky-500/20 text-sky-500 text-xs flex items-center justify-between shrink-0">
          <div className="flex items-center gap-1.5 min-w-0 pr-2">
            <Zap className="w-3.5 h-3.5 shrink-0 text-sky-400" />
            <span className="truncate text-[11px]">
              检测到原生纯净线路【{firstM3u8.sourceName}】
            </span>
          </div>
          <button
            onClick={() => switchMediaSource(firstM3u8.sourceId)}
            className="px-2.5 py-0.5 rounded-full bg-sky-500 active:bg-sky-600 text-white font-semibold text-[11px] shrink-0 active:scale-95 shadow-sm"
          >
            一键直连
          </button>
        </div>
      )}

      {/* Title & Micro Actions Row */}
      <div
        data-tauri-drag-region
        className="px-3.5 py-2.5 bg-white/70 dark:bg-[#0b0d13]/80 border-b border-black/[0.05] dark:border-white/[0.06] flex items-center justify-between gap-2 shrink-0"
      >
        <div className="min-w-0 flex-1" data-tauri-drag-region>
          <h1 className="text-[15px] font-bold text-slate-900 dark:text-white truncate tracking-tight">
            {currentVideo.title}
          </h1>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 dark:text-slate-500 mt-0.5 truncate">
            <span className="px-1.5 py-0.5 rounded-md bg-sky-500/10 text-sky-600 dark:text-sky-400 font-semibold text-[10px]">
              {currentVideo.platformName}
            </span>
            {activeSource && (
              <span className="truncate max-w-[150px] text-emerald-600 dark:text-emerald-400 font-medium">
                {activeSource.sourceName}
              </span>
            )}
            {currentVideo.duration ? (
              <span>· {formatDuration(currentVideo.duration)}</span>
            ) : null}
          </div>
        </div>

        {/* Sleek Circular Action Buttons */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() =>
              toggleFavorite({
                id: currentVideo.id,
                url: currentVideo.url,
                title: currentVideo.title,
                uploader: currentVideo.uploader || "",
                thumbnail: currentVideo.thumbnail || "",
                platform: currentVideo.platform,
                platformName: currentVideo.platformName,
                duration: currentVideo.duration || 0,
              })
            }
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors active:scale-90 ${
              isFavorite
                ? "text-rose-500 bg-rose-500/10"
                : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5"
            }`}
            title="收藏"
          >
            <Heart className={`w-4 h-4 ${isFavorite ? "fill-current" : ""}`} />
          </button>

          <button
            onClick={handleDownload}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors active:scale-90"
            title="下载"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            onClick={handleCopyLink}
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 transition-colors active:scale-90"
            title="分享链接"
          >
            <Share2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Segmented Controls for Sub-views (Single-line guarantee with whitespace-nowrap) */}
      <div className="flex items-center justify-around border-b border-black/[0.06] dark:border-white/[0.08] px-2 shrink-0 bg-white/75 dark:bg-[#0c0f17]/80 backdrop-blur-md">
        {episodeCount > 1 && (
          <button
            onClick={() => setActiveSubTab("episodes")}
            className={`py-2 px-3 text-xs font-semibold whitespace-nowrap relative transition-colors ${
              activeSubTab === "episodes"
                ? "text-sky-500 font-bold"
                : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
            }`}
          >
            <span>选集 ({episodeCount})</span>
            {activeSubTab === "episodes" && (
              <span className="absolute bottom-0 inset-x-2 h-[2px] rounded-full bg-sky-500" />
            )}
          </button>
        )}

        <button
          onClick={() => setActiveSubTab("sources")}
          className={`py-2 px-3 text-xs font-semibold whitespace-nowrap relative transition-colors ${
            activeSubTab === "sources"
              ? "text-sky-500 font-bold"
              : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          }`}
        >
          <span>线路选择 ({sourcesList.length})</span>
          {activeSubTab === "sources" && (
            <span className="absolute bottom-0 inset-x-2 h-[2px] rounded-full bg-sky-500" />
          )}
        </button>

        <button
          onClick={() => setActiveSubTab("info")}
          className={`py-2 px-3 text-xs font-semibold whitespace-nowrap relative transition-colors ${
            activeSubTab === "info"
              ? "text-sky-500 font-bold"
              : "text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
          }`}
        >
          <span>影片详情</span>
          {activeSubTab === "info" && (
            <span className="absolute bottom-0 inset-x-2 h-[2px] rounded-full bg-sky-500" />
          )}
        </button>
      </div>

      {/* Sub-view Content Area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Episodes Grid (Only shown when multiple episodes exist) */}
        {activeSubTab === "episodes" && episodeCount > 1 && (
          <div className="grid grid-cols-4 gap-2">
            {currentVideo.episodes?.map((ep, idx) => {
              const isCurrent =
                ep.index === currentVideo.currentEpisodeIndex;
              return (
                <button
                  key={ep.index || idx}
                  onClick={() => switchEpisode(ep)}
                  className={`h-9 px-1 rounded-xl text-xs font-semibold transition-all active:scale-95 text-center truncate ${
                    isCurrent
                      ? "bg-sky-500 text-white shadow-sm shadow-sky-500/30 font-bold"
                      : "bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.05] dark:border-white/[0.07] text-slate-700 dark:text-slate-300 hover:bg-black/[0.06] dark:hover:bg-white/[0.08]"
                  }`}
                >
                  {ep.title || `${idx + 1}`}
                </button>
              );
            })}
          </div>
        )}

        {activeSubTab === "sources" && (
          <div className="space-y-2">
            {sourcesList.length > 2 && (
              <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
                {(
                  [
                    { id: "all", label: `全部 (${sourcesList.length})` },
                    {
                      id: "m3u8",
                      label: `极速直链 (${sourcesList.filter((s) => s.sourceType === "m3u8").length})`,
                      hide: !sourcesList.some((s) => s.sourceType === "m3u8"),
                    },
                    {
                      id: "jx",
                      label: `解析专线 (${sourcesList.filter((s) => s.sourceType === "jx_iframe").length})`,
                      hide: !sourcesList.some((s) => s.sourceType === "jx_iframe"),
                    },
                    {
                      id: "official",
                      label: `官方源 (${sourcesList.filter((s) => s.sourceType === "official_web" || s.sourceType === "native").length})`,
                      hide: !sourcesList.some(
                        (s) => s.sourceType === "official_web" || s.sourceType === "native"
                      ),
                    },
                  ] as const
                )
                  .filter((t) => !("hide" in t && t.hide))
                  .map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setSourceFilter(tab.id)}
                      className={`px-2.5 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap transition-all ${
                        sourceFilter === tab.id
                          ? "bg-sky-500 text-white shadow-sm"
                          : "bg-black/[0.04] dark:bg-white/[0.06] text-slate-500 dark:text-slate-400"
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
              </div>
            )}
            <div className="space-y-1.5">
              {sourcesList
                .filter((src) => {
                  if (sourceFilter === "m3u8") return src.sourceType === "m3u8";
                  if (sourceFilter === "jx") return src.sourceType === "jx_iframe";
                  if (sourceFilter === "official")
                    return src.sourceType === "official_web" || src.sourceType === "native";
                  return true;
                })
                .map((src, index) => {
                  const isSelected = src.sourceId === currentVideo.activeSourceId;
                  const isM3u8 = src.sourceType === "m3u8";
                  const isJx = src.sourceType === "jx_iframe";
                  return (
                    <button
                      key={src.sourceId || index}
                      onClick={() => switchMediaSource(src.sourceId)}
                      className={`w-full p-2.5 rounded-xl text-left border flex items-center justify-between transition-all active:scale-[0.99] ${
                        isSelected
                          ? "bg-sky-500/10 border-sky-500/40 text-sky-500 dark:text-sky-400 font-bold"
                          : "bg-white dark:bg-[#0e121a] border-black/[0.05] dark:border-white/[0.06] hover:border-black/10 dark:hover:border-white/10"
                      }`}
                    >
                      <div className="min-w-0 flex-1 flex items-center gap-2.5 mr-2">
                        <div
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                            isM3u8
                              ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                              : isJx
                              ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                              : "bg-sky-500/10 text-sky-500 border border-sky-500/20"
                          }`}
                        >
                          {isM3u8 ? (
                            <Zap className="w-3.5 h-3.5" />
                          ) : (
                            <Globe className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate flex items-center gap-1.5">
                            <span className="truncate">{src.sourceName}</span>
                            {isM3u8 && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-600 dark:text-amber-400 font-medium shrink-0">
                                极速秒播
                              </span>
                            )}
                            {isJx && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                                解析专线
                              </span>
                            )}
                            {(src.episodes?.length || 0) > 1 && (
                              <span className="text-[9px] px-1.5 py-0.2 rounded bg-sky-500/15 text-sky-600 dark:text-sky-400 font-medium shrink-0">
                                {src.episodes?.length}集
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 dark:text-slate-500 truncate mt-0.5">
                            {isM3u8
                              ? "纯净直连 · 零广告 · 原生手势播放器"
                              : isJx
                              ? "网页解析内嵌 · 支持提取直连流与横屏全屏"
                              : "官方原网页预览"}
                          </div>
                        </div>
                      </div>
                      {isSelected ? (
                        <div className="w-5 h-5 rounded-full bg-sky-500 text-white flex items-center justify-center shrink-0 ml-2">
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                        </div>
                      ) : (
                        <span className="shrink-0 whitespace-nowrap text-[11px] text-slate-400 px-2.5 py-1 rounded-md border border-black/5 dark:border-white/10 select-none ml-2">
                          切换
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          </div>
        )}

        {/* Video Info Sub-view */}
        {activeSubTab === "info" && (
          <div className="space-y-2.5">
            <div className="p-3 rounded-xl bg-white dark:bg-[#0e121a] border border-black/[0.05] dark:border-white/[0.06] space-y-1.5">
              <div className="text-xs font-bold text-slate-800 dark:text-slate-200">影片信息</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
                {currentVideo.uploader && (
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      来源 / 主演：
                    </span>
                    <span>{currentVideo.uploader}</span>
                  </div>
                )}
                {currentVideo.duration ? (
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      时长：
                    </span>
                    <span>{formatDuration(currentVideo.duration)}</span>
                  </div>
                ) : null}
                <div>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    来源平台：
                  </span>
                  <span>{currentVideo.platformName}</span>
                </div>
                <div>
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    可用线路：
                  </span>
                  <span>共 {sourcesList.length} 条</span>
                </div>
              </div>
              {currentVideo.description && (
                <div className="pt-2 border-t border-black/[0.05] dark:border-white/[0.06] text-xs text-slate-400 leading-relaxed">
                  {currentVideo.description}
                </div>
              )}
            </div>

            {currentVideo.formats && currentVideo.formats.length > 0 && (
              <div className="p-3 rounded-xl bg-white dark:bg-[#0e121a] border border-black/[0.05] dark:border-white/[0.06] space-y-1.5">
                <div className="text-xs font-bold text-slate-800 dark:text-slate-200">已解析清晰度规格</div>
                <div className="grid grid-cols-2 gap-1.5">
                  {currentVideo.formats.map((fmt) => (
                    <div
                      key={fmt.formatId}
                      className="p-1.5 rounded-lg bg-black/[0.02] dark:bg-white/[0.03] border border-black/[0.04] dark:border-white/[0.05] text-[11px] flex items-center justify-between"
                    >
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {fmt.qualityLabel}
                      </span>
                      <span className="text-[9px] text-slate-400 uppercase">
                        {fmt.ext}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Integrated Bottom Search & Parse Bar (Clean Pill Style) */}
      <div className="px-3 py-2 bg-white/90 dark:bg-[#0b0d13]/95 backdrop-blur-xl border-t border-black/[0.05] dark:border-white/[0.06] shrink-0 z-20">
        <div className="relative flex items-center">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="搜索新片 / 粘贴视频链接..."
            className="w-full pl-8 pr-20 py-1.5 bg-black/[0.03] dark:bg-white/[0.05] border border-black/[0.06] dark:border-white/[0.08] text-slate-800 dark:text-slate-100 text-xs rounded-full focus:outline-none focus:border-sky-500 transition-all placeholder:text-slate-400"
          />
          <div className="absolute right-1 flex items-center gap-1">
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 active:scale-90 transition-transform"
                title="清空"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={handlePasteClipboard}
              className="p-1 text-slate-400 hover:text-sky-500 active:scale-90 transition-transform"
              title="读取剪贴板"
            >
              <Clipboard className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => handleSearch()}
              className="px-2.5 py-0.5 rounded-full bg-sky-500 active:bg-sky-600 text-white text-[11px] font-semibold shadow-sm active:scale-95 transition-all"
            >
              解析
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
