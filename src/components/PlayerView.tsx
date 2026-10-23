import React, { useState, useMemo } from "react";
import {
  Download,
  Heart,
  ListVideo,
  Check,
  Music,
  Film,
  X,
  Globe,
  Loader2,
  PlayCircle,
  Layers,
  Search,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { VideoPlayer } from "./VideoPlayer";
import { formatDuration } from "../utils/format";
import { startDownloadTask } from "../services/api";
import { VideoFormat } from "../types/media";


export const PlayerView: React.FC = () => {
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
    sourcesConfig,
  } = useAppStore();

  const [showDownloadModal, setShowDownloadModal] = useState(false);
  const [dlFormatId, setDlFormatId] = useState<string>("");
  const [dlAudioOnly, setDlAudioOnly] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [sourceCategory, setSourceCategory] = useState<"all" | "official" | "jx" | "m3u8">("all");

  const sources = currentVideo?.sources || [];
  const sortedSources = useMemo(() => {
    return [...sources].sort((a, b) => {
      const getPriority = (s: typeof a) => {
        if (
          s.sourceId === "official-native" ||
          s.sourceType === "official_web" ||
          s.sourceType === "native" ||
          Boolean(s.sourceName?.includes("官方"))
        ) {
          return 0;
        }
        if (s.sourceType === "m3u8") return 1;
        if (s.sourceType === "jx_iframe") return 2;
        return 3;
      };
      return getPriority(a) - getPriority(b);
    });
  }, [sources]);

  const firstM3u8 = sortedSources.find((s) => s.sourceType === "m3u8");
  const firstJx = sortedSources.find((s) => s.sourceType === "jx_iframe");
  const defaultFallbackSource =
    sortedSources.find(
      (s) => s.sourceType === "mp4" || Boolean(s.sourceId?.includes("native"))
    ) ||
    firstM3u8 ||
    firstJx ||
    sortedSources[0] ||
    null;

  const activeSource =
    sortedSources.find((s) => s.sourceId === currentVideo?.activeSourceId) ||
    defaultFallbackSource ||
    sortedSources[0] ||
    null;

  const isIframeSource =
    activeSource?.sourceType === "jx_iframe" ||
    activeSource?.sourceType === "official_web";

  const iframeSrc = useMemo(() => {
    if (!activeSource?.playUrl) return "";
    if (activeSource.sourceType === "official_web" && proxyPort) {
      return `http://127.0.0.1:${proxyPort}/web?url=${encodeURIComponent(activeSource.playUrl)}&ua=desktop&shield=true`;
    }
    if (activeSource.sourceType === "jx_iframe" && proxyPort) {
      const lineCfg = sourcesConfig.parseLines?.find(
        (l) =>
          (l.urlPrefix && activeSource.playUrl?.startsWith(l.urlPrefix)) ||
          l.id === activeSource.sourceId
      );
      const ua = lineCfg?.ua || "desktop";
      const baseRules = ["o.js", "trafficmanager", "union", "adbyunion", "popunder"];
      const blockRules = Array.from(new Set([...(lineCfg?.blockRules || []), ...baseRules]));
      const blockQuery = `&block=${encodeURIComponent(blockRules.join(","))}`;
      return `http://127.0.0.1:${proxyPort}/web?url=${encodeURIComponent(activeSource.playUrl)}&ua=${encodeURIComponent(ua)}&shield=true${blockQuery}`;
    }
    return activeSource.playUrl;
  }, [activeSource, proxyPort, sourcesConfig]);

  const handleQuickSearch = async (kw?: string) => {
    const target = (kw ?? quickQuery).trim();
    if (!target) {
      showToast("请输入想看的电影、电视剧或动漫名称");
      return;
    }
    await loadAndPlayUrl(target);
  };

  if (isParsing) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-8">
        <div className="w-12 h-12 rounded-2xl bg-sky-500/15 border border-sky-500/30 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-sky-500 animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <h3 className="text-sm font-bold vx-title">
            正在并行检索播放源...
          </h3>
          <p className="text-xs vx-muted">
            正在聚合多线路媒体源与选集列表
          </p>
        </div>
      </div>
    );
  }

  if (!currentVideo) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-5 p-8 text-center">
        <div className="w-14 h-14 rounded-2xl vx-subtle border flex items-center justify-center text-sky-500">
          <PlayCircle className="w-7 h-7" />
        </div>
        <div className="space-y-1.5 max-w-lg">
          <h3 className="text-base font-bold vx-title">
            聚合高清媒体播放器
          </h3>
          <p className="text-xs vx-muted leading-relaxed">
            在「网站导航」浏览视频时点击右上角「解析播放」，或在下方输入片名，即可聚合多线路源高清播放。
          </p>
        </div>

        <div className="w-full max-w-md space-y-3">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 text-sky-500 absolute left-3.5 pointer-events-none" />
            <input
              type="text"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleQuickSearch();
              }}
              placeholder="输入电影 / 电视剧 / 动漫名称快速搜索..."
              className="w-full h-10 pl-10 pr-20 rounded-xl vx-input text-xs focus:outline-none focus:border-sky-500"
            />
            <button
              onClick={() => handleQuickSearch()}
              className="absolute right-1.5 px-3 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold flex items-center gap-1"
            >
              <Search className="w-3.5 h-3.5" />
              <span>搜索</span>
            </button>
          </div>

          {history.length > 0 ? (
            <div className="flex flex-wrap items-center justify-center gap-1.5">
              <span className="text-[11px] vx-muted">最近播放：</span>
              {history.slice(0, 5).map((item) => (
                <button
                  key={item.id}
                  onClick={() => loadAndPlayUrl(item.url)}
                  className="px-2.5 py-1 rounded-lg vx-subtle hover:border-sky-500/40 border text-[11px] vx-text hover:text-sky-500 transition-colors max-w-[150px] truncate"
                  title={item.title}
                >
                  {item.title}
                </button>
              ))}
            </div>
          ) : (
            <div className="text-[11px] vx-muted flex items-center justify-center gap-2">
              <span>支持输入 HLS (.m3u8)、MP4 直链或网络媒体网址</span>
            </div>
          )}
        </div>

        <button
          onClick={() => setActiveTab("discover")}
          className="px-4 py-2 rounded-xl vx-subtle border hover:border-sky-500/40 vx-text text-xs font-medium flex items-center gap-1.5 transition-colors"
        >
          <Globe className="w-3.5 h-3.5 text-sky-500" />
          <span>前往网站导航浏览</span>
        </button>
      </div>
    );
  }

  const isFav = history.some(
    (h) =>
      (h.url === currentVideo?.url || h.id === currentVideo?.id) && h.isFavorite
  );

  const effectiveFormat =
    selectedFormat && (selectedFormat.videoUrl || selectedFormat.formatId)
      ? selectedFormat
      : (activeSource?.formats && activeSource.formats[0]) ||
        (currentVideo?.formats && currentVideo.formats[0]) ||
        null;

  const isOfficialSource = (s: (typeof sortedSources)[0]) =>
    s.sourceId === "official-native" ||
    s.sourceType === "official_web" ||
    s.sourceType === "native" ||
    Boolean(s.sourceName?.includes("官方"));

  const officialSources = sortedSources.filter(isOfficialSource);
  const jxSources = sortedSources.filter((s) => s.sourceType === "jx_iframe");
  const m3u8Sources = sortedSources.filter((s) => s.sourceType === "m3u8");

  const displayedSources = sortedSources.filter((s) => {
    if (sourceCategory === "official") return isOfficialSource(s);
    if (sourceCategory === "jx") return s.sourceType === "jx_iframe";
    if (sourceCategory === "m3u8") return s.sourceType === "m3u8";
    return true;
  });

  const openDownloadDialog = () => {
    setDlFormatId(
      selectedFormat?.formatId || currentVideo?.formats?.[0]?.formatId || "best"
    );
    setShowDownloadModal(true);
  };

  const handleConfirmDownload = async () => {
    const chosenFmt: VideoFormat | undefined =
      currentVideo?.formats?.find((f) => f.formatId === dlFormatId) ||
      selectedFormat ||
      currentVideo?.formats?.[0];

    const downloadStreamUrl =
      chosenFmt?.videoUrl
        ? chosenFmt.videoUrl
        : currentVideo.url;

    setShowDownloadModal(false);
    showToast(
      `已加入下载队列：${
        dlAudioOnly ? "MP3 纯音频" : chosenFmt?.qualityLabel || "视频"
      }`
    );

    try {
      const task = await startDownloadTask({
        url: downloadStreamUrl,
        title: currentVideo.title,
        thumbnail: currentVideo.thumbnail,
        platformName: currentVideo.platformName,
        formatId: chosenFmt?.formatId || "best",
        qualityLabel: chosenFmt?.qualityLabel || "1080P 高清",
        height: chosenFmt?.height || 1080,
        audioOnly: dlAudioOnly,
        downloadDir: settings.downloadDir,
        proxyUrl: settings.proxyUrl,
      });
      upsertDownloadTask(task);
    } catch (e: any) {
      showToast("启动下载失败：" + (e?.message || String(e)));
    }
  };

  return (
    <div className="h-full overflow-y-auto p-3 sm:p-5">
      {parseError && (
        <div className="mb-4 px-4 py-2.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-500 text-xs flex items-center justify-between">
          <span>解析提示：{parseError}</span>
          <button
            onClick={() => setActiveTab("discover")}
            className="px-3 py-1 rounded-lg bg-amber-500 text-slate-950 font-semibold"
          >
            返回网页浏览
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
        <div className="xl:col-span-8 space-y-4">
          {isIframeSource && firstM3u8 && (
            <div className="px-4 py-2.5 rounded-xl bg-sky-500/10 border border-sky-500/25 text-sky-400 text-xs flex items-center justify-between shadow-sm">
              <span className="flex items-center gap-1.5 font-medium">
                <span>💡</span>
                <span>
                  当前为第三方网页解析专线（若遇到网页黑屏或加载异常，可随时切换为原生超清播放）
                </span>
              </span>
              <button
                onClick={() => switchMediaSource(firstM3u8.sourceId)}
                className="px-3 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white font-semibold text-xs transition-colors shrink-0 flex items-center gap-1"
              >
                <span>一键切换为超清直链</span>
              </button>
            </div>
          )}

          {isIframeSource ? (
            <div className="w-full aspect-video rounded-2xl overflow-hidden bg-black border vx-divider shadow-2xl relative">
              <iframe
                key={iframeSrc}
                src={iframeSrc}
                title={activeSource?.sourceName || "视频播放"}
                className="w-full h-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                allowFullScreen
                sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
              />
            </div>
          ) : (
            <VideoPlayer
              video={currentVideo}
              format={effectiveFormat}
              danmakuList={danmakuList}
              initialSeekTime={initialSeekTime}
              onOpenDownloadModal={openDownloadDialog}
            />
          )}

          <div className="vx-card rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1.5 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-500 text-[11px] font-semibold border border-sky-500/30">
                  {currentVideo.platformName}
                </span>
                <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-500 text-[11px] font-semibold border border-emerald-500/30">
                  {activeSource
                    ? activeSource.sourceName
                    : selectedFormat?.qualityLabel || "1080P 高清直连"}
                </span>
                {sources.length > 1 && (
                  <span className="px-2 py-0.5 rounded-md bg-indigo-500/15 text-indigo-400 text-[11px] font-semibold border border-indigo-500/30">
                    已检索到 {sources.length} 个播放源
                  </span>
                )}
              </div>
              <h1 className="text-base font-bold vx-title leading-snug truncate">
                {currentVideo.title}
              </h1>
              <p className="text-xs vx-muted truncate">
                主演 / 来源：{currentVideo.uploader}
              </p>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() =>
                  toggleFavorite({
                    id: currentVideo.id,
                    url: currentVideo.url,
                    title: currentVideo.title,
                    uploader: currentVideo.uploader,
                    thumbnail: currentVideo.thumbnail,
                    platform: currentVideo.platform,
                    platformName: currentVideo.platformName,
                    duration: currentVideo.duration,
                  })
                }
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-1.5 border transition-all ${
                  isFav
                    ? "bg-rose-500/15 border-rose-500/40 text-rose-500"
                    : "vx-subtle vx-text hover:vx-title"
                }`}
              >
                <Heart
                  className={`w-3.5 h-3.5 ${
                    isFav ? "fill-rose-500 text-rose-500" : ""
                  }`}
                />
                <span>{isFav ? "已收藏" : "收藏"}</span>
              </button>

              <button
                onClick={openDownloadDialog}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 transition-all"
              >
                <Download className="w-3.5 h-3.5" />
                <span>下载视频</span>
              </button>
            </div>
          </div>
        </div>

        <div className="xl:col-span-4 space-y-4">
          <div className="vx-card rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-bold vx-title">
                <Layers className="w-4 h-4 text-sky-500" />
                <span>
                  播放线路切换 ({sources.length || 1})
                </span>
              </div>
              <button
                onClick={() => setActiveTab("discover")}
                className="text-xs text-sky-500 hover:text-sky-400 font-medium flex items-center gap-1"
              >
                <Globe className="w-3.5 h-3.5" />
                <span>返回网页浏览</span>
              </button>
            </div>

            <div className="relative flex items-center">
              <Search className="w-3.5 h-3.5 vx-muted absolute left-3 pointer-events-none" />
              <input
                type="text"
                value={quickQuery}
                onChange={(e) => setQuickQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleQuickSearch();
                }}
                placeholder="输入片名搜索播放源..."
                className="w-full h-8 pl-8 pr-16 rounded-xl vx-input text-xs focus:outline-none focus:border-sky-500"
              />
              <button
                onClick={() => handleQuickSearch()}
                className="absolute right-1 px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[11px] font-semibold"
              >
                换片
              </button>
            </div>

            {sortedSources.length > 0 && (
              <div className="flex items-center gap-1 overflow-x-auto pb-1 text-[11px] font-medium select-none">
                <button
                  onClick={() => setSourceCategory("all")}
                  className={`px-2 py-1 rounded-lg transition-all shrink-0 ${
                    sourceCategory === "all"
                      ? "bg-sky-500 text-white font-bold shadow-sm"
                      : "vx-subtle hover:bg-sky-500/10 vx-muted"
                  }`}
                >
                  全部 ({sortedSources.length})
                </button>
                {officialSources.length > 0 && (
                  <button
                    onClick={() => setSourceCategory("official")}
                    className={`px-2 py-1 rounded-lg transition-all shrink-0 ${
                      sourceCategory === "official"
                        ? "bg-sky-500 text-white font-bold shadow-sm"
                        : "vx-subtle hover:bg-sky-500/10 vx-muted"
                    }`}
                  >
                    官方源 ({officialSources.length})
                  </button>
                )}
                {m3u8Sources.length > 0 && (
                  <button
                    onClick={() => setSourceCategory("m3u8")}
                    className={`px-2 py-1 rounded-lg transition-all shrink-0 ${
                      sourceCategory === "m3u8"
                        ? "bg-emerald-500 text-white font-bold shadow-sm"
                        : "vx-subtle hover:bg-emerald-500/10 vx-muted"
                    }`}
                  >
                    聚合直链 ({m3u8Sources.length})
                  </button>
                )}
                {jxSources.length > 0 && (
                  <button
                    onClick={() => setSourceCategory("jx")}
                    className={`px-2 py-1 rounded-lg transition-all shrink-0 ${
                      sourceCategory === "jx"
                        ? "bg-amber-500 text-white font-bold shadow-sm"
                        : "vx-subtle hover:bg-amber-500/10 vx-muted"
                    }`}
                  >
                    解析专线 ({jxSources.length})
                  </button>
                )}
              </div>
            )}

            {displayedSources.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-2 max-h-80 overflow-y-auto pr-1">
                {displayedSources.map((src) => {
                  const isActive = src.sourceId === activeSource?.sourceId;
                  const isOfficial = isOfficialSource(src);
                  const isDirectM3u8 = src.sourceType === "m3u8";
                  const badgeText = isOfficial
                    ? "官方源"
                    : isDirectM3u8
                    ? "聚合直链"
                    : "解析专线";
                  const badgeStyle = isOfficial
                    ? "bg-sky-500/15 text-sky-500 border border-sky-500/30"
                    : isDirectM3u8
                    ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
                    : "bg-amber-500/15 text-amber-500 border border-amber-500/30";
                  return (
                    <button
                      key={src.sourceId}
                      onClick={() => switchMediaSource(src.sourceId)}
                      className={`w-full p-2.5 rounded-xl text-left text-xs flex items-center justify-between gap-2 transition-all border ${
                        isActive
                          ? "bg-sky-500/15 border-sky-500 text-sky-500 font-semibold shadow-sm"
                          : "vx-subtle hover:border-sky-500/30 vx-text"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`px-1.5 py-0.5 rounded text-[10px] font-bold shrink-0 ${badgeStyle}`}
                          >
                            {badgeText}
                          </span>
                          <span className="truncate">{src.sourceName}</span>
                        </div>
                        <div className="text-[11px] vx-muted truncate mt-0.5">
                          {src.matchedTitle}{" "}
                          {(src.episodes?.length || 0) > 1
                            ? `· 共${src.episodes?.length}集`
                            : `· ${src.remarks || ""}`}
                        </div>
                      </div>
                      {isActive && (
                        <Check className="w-4 h-4 text-sky-500 shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="p-4 text-center text-xs vx-muted">
                当前分类暂无播放线路
              </div>
            )}
          </div>

          <div className="vx-card rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-bold vx-title">
                <ListVideo className="w-4 h-4 text-sky-500" />
                <span>选集列表 ({currentVideo?.episodes?.length || 1})</span>
              </div>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-4 xl:grid-cols-3 gap-2 max-h-72 overflow-y-auto pr-1">
              {((currentVideo?.episodes?.length || 0) > 0
                ? currentVideo.episodes
                : [
                    {
                      index: 1,
                      id: currentVideo?.id || "default",
                      title: "正片",
                      duration: currentVideo?.duration || 0,
                      url: currentVideo?.url || "",
                    },
                  ]
              ).map((ep) => {
                const isCurrent =
                  ep.index === currentVideo.currentEpisodeIndex ||
                  ep.url === selectedFormat?.videoUrl;
                return (
                  <button
                    key={ep.id + ep.index}
                    onClick={() => switchEpisode(ep)}
                    title={ep.title}
                    className={`px-2.5 py-2 rounded-xl text-center text-xs truncate transition-all border ${
                      isCurrent
                        ? "bg-sky-500 text-white border-sky-500 font-semibold shadow-sm"
                        : "vx-subtle hover:border-sky-500/30 vx-text"
                    }`}
                  >
                    {ep.title || `第${ep.index}集`}
                    {ep.duration > 0 && (
                      <span className="block font-mono text-[10px] opacity-75">
                        {formatDuration(ep.duration)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {showDownloadModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="vx-card rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-500">
                  <Download className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold vx-title">
                    下载视频到本地电脑
                  </h3>
                  <p className="text-xs vx-muted">
                    自动合并最高音质并输出为标准兼容格式
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowDownloadModal(false)}
                className="p-1.5 vx-muted hover:vx-title rounded-lg"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                onClick={() => setDlAudioOnly(false)}
                className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  !dlAudioOnly
                    ? "bg-sky-500/15 border-sky-500 text-sky-500"
                    : "vx-subtle vx-text"
                }`}
              >
                <Film className="w-4 h-4" />
                <span>下载完整视频 (MP4)</span>
              </button>
              <button
                onClick={() => setDlAudioOnly(true)}
                className={`p-3 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                  dlAudioOnly
                    ? "bg-sky-500/15 border-sky-500 text-sky-500"
                    : "vx-subtle vx-text"
                }`}
              >
                <Music className="w-4 h-4" />
                <span>仅提取声音 (MP3)</span>
              </button>
            </div>

            {!dlAudioOnly && (
              <div className="space-y-2">
                <label className="text-xs font-medium vx-text">
                  选择下载清晰度：
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(currentVideo?.formats || []).map((fmt) => (
                    <button
                      key={fmt.formatId}
                      onClick={() => setDlFormatId(fmt.formatId)}
                      className={`p-2.5 rounded-xl border text-left text-xs flex items-center justify-between ${
                        dlFormatId === fmt.formatId
                          ? "bg-emerald-500/15 border-emerald-500 text-emerald-500 font-semibold"
                          : "vx-subtle vx-text"
                      }`}
                    >
                      <span>{fmt.qualityLabel}</span>
                      {dlFormatId === fmt.formatId && (
                        <Check className="w-3.5 h-3.5 shrink-0" />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                onClick={() => setShowDownloadModal(false)}
                className="px-4 py-2.5 rounded-xl vx-subtle border text-xs vx-text font-medium"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDownload}
                className="px-5 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5"
              >
                <Download className="w-4 h-4" />
                <span>立即开始下载</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
