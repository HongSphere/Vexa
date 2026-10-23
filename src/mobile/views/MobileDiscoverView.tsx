import React, { useState, useRef, useEffect } from "react";
import {
  Sparkles,
  RotateCw,
  Film,
  Tv,
  ArrowRight,
  ChevronLeft,
  Compass,
  PackageOpen,
  Settings,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";

export const MobileDiscoverView: React.FC = () => {
  const {
    activePlatform,
    setActivePlatform,
    currentWebviewUrl,
    setCurrentWebviewUrl,
    loadAndPlayUrl,
    sourcesConfig,
    history,
    setActiveTab,
    isParsing,
    showToast,
    proxyPort,
  } = useAppStore();

  const [viewMode, setViewMode] = useState<"portal" | "webview">("portal");
  const [activeInitialUrl, setActiveInitialUrl] = useState<string>("");
  const [historyDepth, setHistoryDepth] = useState<number>(1);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const sites = sourcesConfig.sites || [];
  const currentSite =
    sites.find((s) => s.id === activePlatform) || sites[0] || null;

  const rawTargetUrl =
    activeInitialUrl ||
    currentWebviewUrl ||
    currentSite?.mobileHomeUrl ||
    currentSite?.homeUrl ||
    "";

  const handleParseOrSearch = async (val?: string) => {
    const query = (val || currentWebviewUrl || rawTargetUrl || "").trim();
    if (!query) {
      showToast("未检测到有效视频链接");
      return;
    }
    await loadAndPlayUrl(query);
  };

  const handleBack = () => {
    if (historyDepth > 1) {
      setHistoryDepth((prev) => Math.max(1, prev - 1));
      try {
        iframeRef.current?.contentWindow?.postMessage({ type: "VEXA_NAV_BACK" }, "*");
      } catch {}
    } else {
      setViewMode("portal");
    }
  };

  // Listen for inner navigation messages from the proxy script
  useEffect(() => {
    const handleMsg = (e: MessageEvent) => {
      if (e.data?.type === "VEXA_NAV_URL" && e.data?.url) {
        setCurrentWebviewUrl(e.data.url);
        if (activeInitialUrl && e.data.url !== activeInitialUrl) {
          setHistoryDepth((prev) => prev + 1);
        }
      }
    };
    window.addEventListener("message", handleMsg);
    return () => window.removeEventListener("message", handleMsg);
  }, [setCurrentWebviewUrl, activeInitialUrl]);

  // Route through local proxy to strip X-Frame-Options & CSP frame-ancestors, preventing net::ERR_BLOCKED_BY_RESPONSE
  const iframeSrc = rawTargetUrl
    ? proxyPort
      ? `http://127.0.0.1:${proxyPort}/web?url=${encodeURIComponent(rawTargetUrl)}`
      : rawTargetUrl
    : "";

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-[#07090e] select-none">
      {/* Main View Area */}
      {viewMode === "portal" ? (
        <div className="flex-1 overflow-y-auto p-3.5 space-y-4">
          {/* Recent Playback History Tags if available */}
          {history.length > 0 && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">
                <span>最近播放记录</span>
                <span className="text-[10px] text-slate-400 font-normal">点击快速续播</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {history.slice(0, 6).map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleParseOrSearch(item.url)}
                    className="px-2.5 py-1 rounded-xl bg-white dark:bg-[#12151d] border border-black/[0.05] dark:border-white/[0.06] text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-sky-500/40 active:scale-95 transition-all shadow-xs flex items-center gap-1 max-w-[150px] truncate"
                    title={item.title}
                  >
                    <Film className="w-3 h-3 text-sky-500 shrink-0" />
                    <span className="truncate">{item.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Platform Navigation Cards Grid */}
          {sites.length === 0 ? (
            <div className="p-6 rounded-2xl bg-white dark:bg-[#12151d] border border-black/[0.06] dark:border-white/[0.08] text-center space-y-3 shadow-xs my-4">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-500">
                <PackageOpen className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  暂未配置站点导航
                </h3>
                <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                  可前往“设置”导入自定义站点规则文件或远程订阅地址。
                </p>
              </div>
              <div className="pt-1">
                <button
                  onClick={() => setActiveTab("settings")}
                  className="w-full py-2 px-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold flex items-center justify-center gap-1.5 shadow-sm active:scale-98 transition-all"
                >
                  <Settings className="w-3.5 h-3.5" />
                  <span>前往导入规则</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] font-bold text-slate-400 uppercase tracking-wider px-1">
                <span>内置网站导航 ({sites.length})</span>
                <span className="text-[10px] text-slate-400 font-normal">点击进入浏览</span>
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                {sites.map((site) => {
                  const brandColor = site.color || "#0ea5e9";
                  const targetUrl = site.mobileHomeUrl || site.homeUrl;

                  return (
                    <div
                      key={site.id}
                      onClick={() => {
                        setActivePlatform(site.id);
                        setActiveInitialUrl(targetUrl);
                        setCurrentWebviewUrl(targetUrl);
                        setHistoryDepth(1);
                        setViewMode("webview");
                      }}
                      className="p-3.5 rounded-2xl bg-white dark:bg-[#12151d] border border-black/[0.06] dark:border-white/[0.08] shadow-sm space-y-2.5 flex flex-col justify-between active:scale-[0.98] transition-all cursor-pointer hover:border-sky-500/40"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                            style={{ backgroundColor: brandColor }}
                          />
                          <span className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {site.name}
                          </span>
                        </div>
                        <Tv className="w-3.5 h-3.5 text-slate-400" />
                      </div>

                      <p className="text-[10px] text-slate-400 line-clamp-1">
                        {site.desc || `${site.name}官方门户`}
                      </p>

                      <div className="pt-1">
                        <div className="w-full py-1.5 px-2 rounded-xl bg-sky-500/10 hover:bg-sky-500/20 text-[11px] font-bold text-sky-600 dark:text-sky-400 flex items-center justify-center gap-1.5 transition-all">
                          <Compass className="w-3 h-3" />
                          <span>进入浏览</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* In-App Direct Browser View */
        <div className="flex-1 w-full min-h-0 relative flex flex-col overflow-hidden bg-white dark:bg-[#07090e]">
          {/* Top In-App Browser Control Bar */}
          <div className="h-11 px-3 bg-white/95 dark:bg-[#0b0d13]/95 backdrop-blur-xl border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between gap-2 z-20 shrink-0">
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                id="vx-webview-portal-btn"
                onClick={() => setViewMode("portal")}
                className="px-2.5 py-1 rounded-xl bg-black/5 dark:bg-white/10 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1 active:scale-95 transition-transform"
              >
                <ArrowRight className="w-3.5 h-3.5 rotate-180" />
                <span>导航</span>
              </button>

              <button
                id="vx-webview-back-btn"
                onClick={handleBack}
                className="p-1.5 rounded-xl bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-sky-500 active:scale-95 shrink-0 transition-transform"
                title="后退上一页"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-w-0 text-center px-2">
              <span className="text-xs font-bold text-slate-900 dark:text-white truncate block">
                {currentSite?.name || "站点浏览"}
              </span>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              <button
                onClick={() => {
                  if (iframeRef.current) {
                    const target =
                      currentWebviewUrl ||
                      activeInitialUrl ||
                      currentSite?.mobileHomeUrl ||
                      currentSite?.homeUrl ||
                      "";
                    iframeRef.current.src = proxyPort
                      ? `http://127.0.0.1:${proxyPort}/web?url=${encodeURIComponent(target)}`
                      : target;
                  }
                }}
                className="p-1.5 rounded-xl bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-sky-500 active:scale-95 shrink-0 transition-transform"
                title="刷新当前页面"
              >
                <RotateCw className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() =>
                  handleParseOrSearch(currentWebviewUrl || activeInitialUrl || rawTargetUrl)
                }
                disabled={isParsing}
                className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 active:from-sky-600 active:to-blue-700 text-white text-xs font-bold flex items-center gap-1 shadow-sm active:scale-95 disabled:opacity-50 transition-all shrink-0"
              >
                {isParsing ? (
                  <RotateCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Sparkles className="w-3.5 h-3.5" />
                )}
                <span>解析本页</span>
              </button>
            </div>
          </div>

          {/* Embedded Web View with Proxy & Sandbox Protection */}
          {rawTargetUrl ? (
            <div className="flex-1 w-full min-h-0 relative flex flex-col">
              <iframe
                ref={iframeRef}
                key={activePlatform || "webview"}
                src={iframeSrc}
                title={currentSite?.name || "站点视口"}
                referrerPolicy="no-referrer"
                className="w-full flex-1 border-0 bg-white"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                sandbox="allow-scripts allow-same-origin allow-forms allow-presentation allow-popups"
              />
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-6 text-center text-xs text-slate-400">
              <span>暂无可用的网页地址</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MobileDiscoverView;
