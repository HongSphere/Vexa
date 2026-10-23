import React, { useCallback, useEffect, useRef } from "react";
import { Loader2, PackageOpen, Settings } from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { actionPlatformWebview, syncPlatformWebview, isTauri } from "../services/api";

export const DiscoverView: React.FC = () => {
  const {
    activePlatform,
    currentWebviewUrl,
    pendingWebviewNavUrl,
    clearPendingWebviewNavUrl,
    sourcesConfig,
    setActiveTab,
  } = useAppStore();

  const containerRef = useRef<HTMLDivElement | null>(null);

  const sites = sourcesConfig.sites || [];
  const activePlatformInfo =
    sites.find((p) => p.id === activePlatform) ||
    sites[0] || null;

  const syncBoundsOnly = useCallback(
    (targetUrl?: string | null) => {
      const el = containerRef.current;
      if (!el || sites.length === 0) return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;

      syncPlatformWebview({
        url: targetUrl ?? null,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        windowHeight: window.innerHeight,
        visible: true,
      }).catch(() => {});
    },
    [sites.length]
  );

  // Hide webview if no sites configured
  useEffect(() => {
    if (sites.length === 0) {
      actionPlatformWebview("hide").catch(() => {});
    }
  }, [sites.length]);

  // Navigate immediately when user selects a platform tab or clicks home
  useEffect(() => {
    if (pendingWebviewNavUrl && sites.length > 0) {
      syncBoundsOnly(pendingWebviewNavUrl);
      clearPendingWebviewNavUrl();
    }
  }, [pendingWebviewNavUrl, syncBoundsOnly, clearPendingWebviewNavUrl, sites.length]);

  // Keep native child webview bounds synced on mount & window resize
  useEffect(() => {
    if (sites.length === 0) return;
    const el = containerRef.current;
    if (!el) return;

    syncBoundsOnly(pendingWebviewNavUrl ?? currentWebviewUrl);
    const rafId = window.requestAnimationFrame(() => syncBoundsOnly(null));
    const timerId = window.setTimeout(() => syncBoundsOnly(null), 120);

    const ro = new ResizeObserver(() => {
      syncBoundsOnly(null);
    });
    ro.observe(el);

    const handleWinResize = () => syncBoundsOnly(null);
    window.addEventListener("resize", handleWinResize);

    return () => {
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timerId);
      ro.disconnect();
      window.removeEventListener("resize", handleWinResize);
      actionPlatformWebview("hide").catch(() => {});
    };
  }, [syncBoundsOnly, sites.length]);

  if (sites.length === 0) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6 vx-app">
        <div className="max-w-md w-full vx-card rounded-2xl border p-6 text-center space-y-4 shadow-sm">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center text-sky-400">
            <PackageOpen className="w-7 h-7" />
          </div>
          <div>
            <h2 className="text-base font-bold vx-title">
              欢迎使用 Vexa
            </h2>
            <p className="text-xs vx-muted mt-1.5 leading-relaxed">
              当前尚未导入配置，请先载入本地规则文件或订阅链接。
            </p>
          </div>
          <div className="pt-2">
            <button
              onClick={() => setActiveTab("settings")}
              className="w-full py-2.5 px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition-all active:scale-[0.98]"
            >
              <Settings className="w-4 h-4" />
              <span>前往导入配置</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  const targetUrl = activePlatformInfo?.homeUrl || currentWebviewUrl;

  return (
    <div
      ref={containerRef}
      className="h-full w-full relative overflow-hidden flex flex-col vx-app"
    >
      {!isTauri() ? (
        <div className="w-full h-full relative flex flex-col">
          <div className="px-4 py-1.5 bg-sky-500/10 border-b border-sky-500/20 text-xs text-sky-600 dark:text-sky-400 flex items-center justify-between shrink-0">
            <span>浏览器调试模式：当前展示 iframe 预览（Tauri 客户端使用原生多媒体视口）</span>
            {targetUrl && (
              <button
                onClick={() => window.open(targetUrl, "_blank")}
                className="font-bold underline ml-2"
              >
                新标签页打开 ↗
              </button>
            )}
          </div>
          <iframe
            key={targetUrl}
            src={targetUrl}
            title={activePlatformInfo?.name || "站点视口"}
            className="w-full flex-1 border-0 bg-white"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </div>
      ) : (
        <div className="text-center space-y-2.5 vx-muted select-none pointer-events-none my-auto">
          <Loader2 className="w-6 h-6 text-sky-500 animate-spin mx-auto" />
          <p className="text-xs font-medium">
            正在连接 {activePlatformInfo?.name || "官方网站"}...
          </p>
        </div>
      )}
    </div>
  );
};
