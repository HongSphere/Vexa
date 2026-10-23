import React, { useState } from "react";
import {
  Link2,
  ClipboardPaste,
  Loader2,
  Play,
  X,
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Sparkles,
  Download,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  actionPlatformWebview,
  getCurrentPlatformWebviewUrl,
  startDownloadTask,
} from "../services/api";
import { isLikelyUrlOrCode, extractCleanUrl } from "../utils/format";

export const TopBar: React.FC = () => {
  const [inputValue, setInputValue] = useState("");
  const [isDownloadingPage, setIsDownloadingPage] = useState(false);

  const {
    activeTab,
    isParsing,
    activePlatform,
    setActivePlatform,
    currentWebviewUrl,
    setCurrentWebviewUrl,
    navigateWebviewTo,
    loadAndPlayUrl,
    settings,
    upsertDownloadTask,
    showToast,
    sourcesConfig,
  } = useAppStore();

  const sites = sourcesConfig.sites || [];
  const currentPlatformInfo =
    sites.find((p) => p.id === activePlatform) ||
    sites[0] || {
      id: "empty",
      name: "未配置网站",
      homeUrl: "about:blank",
    };

  const handleUrlSubmit = async (rawText?: string) => {
    const target = (rawText ?? inputValue).trim();
    if (!target) {
      showToast("请粘贴视频链接或输入影视剧名称");
      return;
    }

    if (isLikelyUrlOrCode(target)) {
      await loadAndPlayUrl(extractCleanUrl(target));
    } else {
      await loadAndPlayUrl(target);
    }
  };

  const handlePasteAndPlay = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        showToast("剪贴板为空，请先复制视频链接");
        return;
      }
      setInputValue(text.trim());
      await handleUrlSubmit(text);
    } catch {
      showToast("请复制视频链接后重试");
    }
  };

  const handleAdFreePlayCurrentPage = async () => {
    const liveUrl =
      (await getCurrentPlatformWebviewUrl()) || currentWebviewUrl;
    if (!liveUrl) return;
    setCurrentWebviewUrl(liveUrl);
    await loadAndPlayUrl(liveUrl);
  };

  const handleDirectDownloadCurrentPage = async () => {
    if (isDownloadingPage) return;
    setIsDownloadingPage(true);
    try {
      const liveUrl =
        (await getCurrentPlatformWebviewUrl()) || currentWebviewUrl;
      if (!liveUrl) return;
      setCurrentWebviewUrl(liveUrl);
      showToast("已将当前页面视频加入下载队列");
      const task = await startDownloadTask({
        url: liveUrl,
        title: `${currentPlatformInfo.name} 视频 (${new Date().toLocaleTimeString()})`,
        thumbnail: "",
        platformName: currentPlatformInfo.name,
        formatId: "best",
        qualityLabel: `${settings.preferredQuality}P 优先`,
        height: settings.preferredQuality || 480,
        audioOnly: false,
        downloadDir: settings.downloadDir,
        proxyUrl: settings.proxyUrl,
      });
      upsertDownloadTask(task);
    } catch (e: any) {
      showToast("启动下载失败：" + (e?.message || String(e)));
    } finally {
      setIsDownloadingPage(false);
    }
  };

  return (
    <header className="h-14 shrink-0 vx-topbar backdrop-blur-md border-b px-3 flex items-center justify-between gap-2 select-none transition-colors duration-200 overflow-hidden">
      {/* Left: 7 Major Platforms Official Website Tabs + Browser Controls */}
      <div className="flex items-center gap-1.5 min-w-0 flex-1 overflow-hidden">
        {sites.length > 0 && (
          <div
            onWheel={(e) => {
              if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
            }}
            className="flex items-center gap-0.5 p-1 rounded-xl vx-subtle border overflow-x-auto no-scrollbar min-w-0 scroll-smooth"
            style={{ touchAction: "pan-x", WebkitOverflowScrolling: "touch" }}
          >
            {sites.map((platform) => {
              const isSelected =
                activeTab === "discover" && activePlatform === platform.id;
              const dotColor = platform.color || "#38bdf8";
              return (
                <button
                  key={platform.id}
                  onClick={() => setActivePlatform(platform.id)}
                  className={`px-2 py-1 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
                    isSelected
                      ? "bg-sky-500 text-white shadow-sm"
                      : "vx-text hover:vx-title hover:bg-sky-500/[0.08]"
                  }`}
                >
                  <span
                    className="hidden xl:inline-block w-1.5 h-1.5 rounded-full shrink-0"
                    style={{
                      backgroundColor: isSelected ? "#ffffff" : dotColor,
                    }}
                  />
                  <span>{platform.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Browser Controls when on Official Websites tab */}
        {sites.length > 0 && activeTab === "discover" && (
          <div className="flex items-center gap-0.5 p-1 rounded-xl vx-subtle border shrink-0">
            <button
              onClick={() => actionPlatformWebview("back")}
              title="后退"
              className="p-1.5 rounded-lg vx-muted hover:vx-title hover:bg-sky-500/10 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => actionPlatformWebview("forward")}
              title="前进"
              className="p-1.5 rounded-lg vx-muted hover:vx-title hover:bg-sky-500/10 transition-colors"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => actionPlatformWebview("reload")}
              title="刷新页面"
              className="p-1.5 rounded-lg vx-muted hover:vx-title hover:bg-sky-500/10 transition-colors"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => navigateWebviewTo(currentPlatformInfo.homeUrl)}
              title={`回到 ${currentPlatformInfo.name} 首页`}
              className="p-1.5 rounded-lg vx-muted hover:vx-title hover:bg-sky-500/10 transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Right: Context-Aware Actions */}
      {activeTab === "discover" ? (
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={handlePasteAndPlay}
            disabled={isParsing}
            title="从剪贴板粘贴视频链接直接播放"
            className="px-2.5 py-1.5 rounded-xl vx-subtle hover:bg-sky-500/10 border text-xs font-medium vx-text flex items-center gap-1 transition-all active:scale-95 whitespace-nowrap"
          >
            <ClipboardPaste className="w-3.5 h-3.5 text-sky-500 shrink-0" />
            <span>粘贴链接</span>
          </button>

          <button
            onClick={handleAdFreePlayCurrentPage}
            disabled={isParsing}
            title="提取当前网页正在浏览的视频到播放器播放"
            className="px-2.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white text-xs font-semibold flex items-center gap-1 shadow-sm transition-all active:scale-95 whitespace-nowrap"
          >
            {isParsing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : (
              <Sparkles className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>解析播放</span>
          </button>

          <button
            onClick={handleDirectDownloadCurrentPage}
            disabled={isDownloadingPage}
            title="下载当前网页正在播放的视频到本地"
            className="px-2.5 py-1.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 text-xs font-bold flex items-center gap-1 shadow-sm transition-all active:scale-95 whitespace-nowrap"
          >
            {isDownloadingPage ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
            ) : (
              <Download className="w-3.5 h-3.5 shrink-0" />
            )}
            <span>下载视频</span>
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2 w-64 lg:w-80 xl:w-96 shrink-0 justify-end">
          <div className="relative flex-1 flex items-center">
            <Link2 className="w-3.5 h-3.5 text-sky-500 absolute left-3 pointer-events-none" />
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleUrlSubmit();
              }}
              placeholder="粘贴视频链接或 BV 号直接解析..."
              className="w-full pl-8 pr-20 py-1.5 vx-input text-xs rounded-xl focus:outline-none focus:border-sky-500 transition-all"
            />
            {inputValue && (
              <button
                onClick={() => setInputValue("")}
                className="absolute right-14 p-1 vx-muted hover:vx-title"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={() => handleUrlSubmit()}
              disabled={isParsing}
              className="absolute right-1 px-2.5 py-1 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-[11px] font-semibold flex items-center gap-1"
            >
              {isParsing ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Play className="w-3 h-3 fill-current" />
              )}
              <span>解析</span>
            </button>
          </div>
        </div>
      )}
    </header>
  );
};
