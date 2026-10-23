import React, { useState, useRef, useEffect } from "react";
import {
  Search,
  Clipboard,
  Sparkles,
  RotateCw,
  Film,
  Tv,
  ArrowRight,
  ChevronLeft,
  Compass,
  PackageOpen,
  Settings,
  ExternalLink,
  Copy,
  Check,
  Globe,
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

  const [inputUrlOrKw, setInputUrlOrKw] = useState("");
  const [viewMode, setViewMode] = useState<"portal" | "webview">("portal");
  const [isCopied, setIsCopied] = useState(false);
  const [showWebviewInput, setShowWebviewInput] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const sites = sourcesConfig.sites || [];
  const currentSite =
    sites.find((s) => s.id === activePlatform) || sites[0] || null;

  const handleParseOrSearch = async (val?: string) => {
    const query = (val ?? inputUrlOrKw).trim();
    if (!query) {
      showToast("请输入片名或粘贴视频链接");
      return;
    }
    await loadAndPlayUrl(query);
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard?.readText();
      if (!text || !text.trim()) {
        showToast("剪贴板内容为空");
        return;
      }
      setInputUrlOrKw(text.trim());
      await handleParseOrSearch(text.trim());
    } catch {
      showToast("请长按输入框直接粘贴");
    }
  };

  const handleCopyTargetUrl = (url: string) => {
    if (!url) return;
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setIsCopied(true);
        showToast("已复制网址到剪贴板");
        setTimeout(() => setIsCopied(false), 2000);
      })
      .catch(() => {
        showToast("复制失败，请手动选择复制");
      });
  };

  const handleOpenExternal = (url: string) => {
    if (!url) return;
    try {
      window.open(url, "_blank");
    } catch {
      showToast("无法打开外部浏览器");
    }
  };

  const rawTargetUrl =
    currentWebviewUrl || currentSite?.mobileHomeUrl || currentSite?.homeUrl || "";

  // Listen for inner navigation messages from the proxy script
  useEffect(() => {
    const handleMsg = (e: MessageEvent) => {
      if (e.data?.type === "VEXA_NAV_URL" && e.data?.url) {
        setCurrentWebviewUrl(e.data.url);
      }
    };
    window.addEventListener("message", handleMsg);
    return () => window.removeEventListener("message", handleMsg);
  }, [setCurrentWebviewUrl]);

  // Route through local proxy to strip X-Frame-Options & CSP frame-ancestors, preventing net::ERR_BLOCKED_BY_RESPONSE
  const iframeSrc = rawTargetUrl
    ? proxyPort
      ? `http://127.0.0.1:${proxyPort}/web?url=${encodeURIComponent(rawTargetUrl)}`
      : rawTargetUrl
    : "";

  return (
    <div className="h-full flex flex-col overflow-hidden bg-slate-50 dark:bg-[#07090e] select-none">
      {/* Top Universal Search & Link Parser Capsule (only in portal view) */}
      {viewMode === "portal" && (
        <div className="p-3 bg-white/90 dark:bg-[#0b0d13]/95 backdrop-blur-xl border-b border-black/[0.06] dark:border-white/[0.08] shrink-0 space-y-2 z-20">
          <div className="flex items-center gap-1.5 p-1.5 rounded-2xl bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] focus-within:border-sky-500/50 transition-colors shadow-inner">
            <Search className="w-4 h-4 text-slate-400 ml-2 shrink-0" />
            <input
              type="text"
              value={inputUrlOrKw}
              onChange={(e) => setInputUrlOrKw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleParseOrSearch()}
              placeholder="粘贴网络视频链接 或 输入片名搜索..."
              className="flex-1 bg-transparent text-xs text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none min-w-0"
            />

            <button
              onClick={handlePasteClipboard}
              className="px-2 py-1 rounded-xl bg-black/5 dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1 active:scale-95 transition-all shrink-0"
              title="读取剪贴板"
            >
              <Clipboard className="w-3 h-3 text-sky-500" />
              <span>粘贴</span>
            </button>

            <button
              onClick={() => handleParseOrSearch()}
              disabled={isParsing}
              className="px-3 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 active:from-sky-600 active:to-blue-700 text-white text-xs font-bold flex items-center gap-1 shadow-sm active:scale-95 disabled:opacity-50 transition-all shrink-0"
            >
              {isParsing ? (
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>解析播放</span>
            </button>
          </div>
        </div>
      )}

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
                        setCurrentWebviewUrl(targetUrl);
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
          <div className="h-11 px-3 bg-white/95 dark:bg-[#0b0d13]/95 backdrop-blur-xl border-b border-black/[0.06] dark:border-white/[0.08] flex items-center justify-between gap-1.5 z-20 shrink-0">
            <button
              onClick={() => setViewMode("portal")}
              className="px-2.5 py-1 rounded-xl bg-black/5 dark:bg-white/10 text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1 active:scale-95 shrink-0 transition-transform"
            >
              <ArrowRight className="w-3.5 h-3.5 rotate-180" />
              <span>导航</span>
            </button>

            <button
              onClick={() => {
                try {
                  iframeRef.current?.contentWindow?.history.back();
                } catch {}
              }}
              className="p-1.5 rounded-xl bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-sky-500 active:scale-95 shrink-0 transition-transform"
              title="后退上一页"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>

            <div className="flex-1 min-w-0 text-center px-1">
              <span className="text-xs font-bold text-slate-900 dark:text-white truncate block">
                {currentSite?.name || "站点浏览"}
              </span>
            </div>

            {/* Copy Link Button */}
            <button
              onClick={() => handleCopyTargetUrl(rawTargetUrl)}
              className="p-1.5 rounded-xl bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-sky-500 active:scale-95 shrink-0 transition-transform"
              title="复制当前网址"
            >
              {isCopied ? (
                <Check className="w-3.5 h-3.5 text-emerald-500" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>

            {/* Open in external browser if user wants native experience */}
            <button
              onClick={() => handleOpenExternal(rawTargetUrl)}
              className="p-1.5 rounded-xl bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-sky-500 active:scale-95 shrink-0 transition-transform"
              title="在外部浏览器中打开"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>

            {/* Refresh */}
            <button
              onClick={() => {
                if (iframeRef.current && iframeSrc) {
                  iframeRef.current.src = iframeSrc;
                }
              }}
              className="p-1.5 rounded-xl bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-sky-500 active:scale-95 shrink-0 transition-transform"
              title="刷新当前页面"
            >
              <RotateCw className="w-3.5 h-3.5" />
            </button>

            {/* Toggle URL input */}
            <button
              onClick={() => setShowWebviewInput(!showWebviewInput)}
              className={`p-1.5 rounded-xl text-slate-600 dark:text-slate-300 active:scale-95 shrink-0 transition-transform ${
                showWebviewInput
                  ? "bg-sky-500 text-white"
                  : "bg-black/5 dark:bg-white/10 hover:text-sky-500"
              }`}
              title="输入或粘贴指定链接"
            >
              <Search className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() =>
                handleParseOrSearch(currentWebviewUrl || rawTargetUrl)
              }
              disabled={isParsing}
              className="px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 active:from-sky-600 active:to-blue-700 text-white text-xs font-bold flex items-center gap-1 shadow-sm active:scale-95 disabled:opacity-50 transition-all shrink-0"
            >
              {isParsing ? (
                <RotateCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5" />
              )}
              <span>解析本页</span>
            </button>
          </div>

          {/* Optional Direct URL / Keyword Bar inside Webview */}
          {showWebviewInput && (
            <div className="p-2 bg-white/95 dark:bg-[#0e121a]/95 backdrop-blur-md border-b border-black/[0.06] dark:border-white/[0.08] flex items-center gap-1.5 z-20">
              <input
                type="text"
                value={inputUrlOrKw}
                onChange={(e) => setInputUrlOrKw(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleParseOrSearch()}
                placeholder="粘贴正在浏览的视频网址或分享文本..."
                className="flex-1 px-3 py-1.5 bg-black/[0.04] dark:bg-white/[0.06] border border-black/[0.06] dark:border-white/[0.08] rounded-xl text-xs text-slate-900 dark:text-white focus:outline-none focus:border-sky-500"
              />
              <button
                onClick={handlePasteClipboard}
                className="p-1.5 rounded-xl bg-black/5 dark:bg-white/10 text-slate-600 dark:text-slate-300 hover:text-sky-500"
                title="粘贴剪贴板"
              >
                <Clipboard className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => handleParseOrSearch()}
                disabled={isParsing}
                className="px-3 py-1.5 rounded-xl bg-sky-500 text-white text-xs font-semibold shrink-0"
              >
                解析
              </button>
            </div>
          )}

          {/* Embedded Web View with Proxy & Sandbox Protection */}
          {rawTargetUrl ? (
            <div className="flex-1 relative flex flex-col">
              <iframe
                ref={iframeRef}
                key={rawTargetUrl}
                src={iframeSrc}
                title={currentSite?.name || "站点视口"}
                className="w-full flex-1 border-0 bg-white"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                sandbox="allow-scripts allow-same-origin allow-forms allow-presentation"
              />

              {/* Graceful Hint for Frame-Restricted Sites */}
              <div className="px-3 py-1.5 bg-slate-100/90 dark:bg-[#0e121a]/90 backdrop-blur-sm border-t border-black/[0.05] dark:border-white/[0.05] flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 shrink-0">
                <span className="truncate">
                  如遇站点启用了跨域安全限制无法嵌显，可点击右上角浏览器图标浏览
                </span>
                <button
                  onClick={() => handleOpenExternal(rawTargetUrl)}
                  className="ml-2 text-sky-500 font-semibold shrink-0 flex items-center gap-0.5"
                >
                  <Globe className="w-3 h-3" />
                  <span>浏览器打开</span>
                </button>
              </div>
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
