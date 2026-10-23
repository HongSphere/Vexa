import React, { useEffect, useRef } from "react";
import { onBackButtonPress, exit } from "@tauri-apps/api/app";
import { useAppStore } from "../store/useAppStore";
import { setAppFullscreen } from "../services/api";
import { MobileHeader } from "./components/MobileHeader";
import { MobileTabBar } from "./components/MobileTabBar";
import { MobileDiscoverView } from "./views/MobileDiscoverView";
import { MobilePlayerView } from "./views/MobilePlayerView";
import { MobileDownloadsView } from "./views/MobileDownloadsView";
import { MobileHistoryView } from "./views/MobileHistoryView";
import { MobileSettingsView } from "./views/MobileSettingsView";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { Sparkles } from "lucide-react";

export const MobileApp: React.FC = () => {
  const { activeTab, toastMessage, isMobileFullscreen } = useAppStore();
  const lastBackPressTimeRef = useRef<number>(0);

  // Centralized Android Hardware/Gesture Back Button & Web History PopState Manager
  useEffect(() => {
    let backListener: { unregister: () => Promise<void> } | undefined;

    const handleBackAction = () => {
      const store = useAppStore.getState();

      // 1. If player is in iframe fullscreen or native fullscreen, exit fullscreen instead of exiting app
      const iframeExitFsBtn = document.getElementById("vx-iframe-exit-fs-btn");
      if (iframeExitFsBtn) {
        iframeExitFsBtn.click();
        return;
      }

      if (store.isMobileFullscreen) {
        store.setIsMobileFullscreen(false);
        setAppFullscreen(false).catch(() => {});
        try {
          (window.screen.orientation as any)?.unlock?.();
        } catch {}
        return;
      }

      // 2. If inside Discover webview, navigate back in webview or return to portal
      if (store.activeTab === "discover") {
        const webviewBackBtn = document.getElementById("vx-webview-back-btn");
        if (webviewBackBtn) {
          webviewBackBtn.click();
          return;
        }
      }

      // 3. If in another tab, return to main discover tab
      if (store.activeTab !== "discover") {
        store.setActiveTab("discover");
        return;
      }

      // 4. On root discover portal: double press to exit
      const now = Date.now();
      if (now - lastBackPressTimeRef.current < 2000) {
        exit(0).catch(() => {});
      } else {
        lastBackPressTimeRef.current = now;
        store.showToast("再按一次退出应用");
      }
    };

    // Expose globally for native Android MainActivity evaluateJavascript bridge
    (window as any).__VEXA_ON_BACK_PRESSED = handleBackAction;

    // 1. Listen for native Android back button via Tauri v2 API
    onBackButtonPress(() => {
      handleBackAction();
    })
      .then((listener) => {
        backListener = listener;
      })
      .catch((err) => {
        console.warn("Tauri onBackButtonPress registration warning:", err);
      });

    // 2. Android WebView native DOM backbutton event fallback
    const handleDocumentBackButton = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      handleBackAction();
    };
    document.addEventListener("backbutton", handleDocumentBackButton, false);

    // 3. Browser popstate fallback for mobile web testing
    const handlePopState = () => {
      handleBackAction();
    };
    window.addEventListener("popstate", handlePopState);

    return () => {
      delete (window as any).__VEXA_ON_BACK_PRESSED;
      if (backListener) {
        backListener.unregister().catch(() => {});
      }
      document.removeEventListener("backbutton", handleDocumentBackButton);
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden vx-app select-none transition-colors duration-200">
      {/* Dedicated Mobile Header (hidden in mobile fullscreen) */}
      {!isMobileFullscreen && <MobileHeader />}

      <main className="flex-1 min-h-0 overflow-hidden relative">
        <ErrorBoundary key={activeTab}>
          {activeTab === "discover" && <MobileDiscoverView />}
          {activeTab === "player" && <MobilePlayerView />}
          {activeTab === "downloads" && <MobileDownloadsView />}
          {activeTab === "history" && <MobileHistoryView />}
          {activeTab === "settings" && <MobileSettingsView />}
        </ErrorBoundary>
      </main>

      {/* Dedicated Native Mobile Bottom Tab Bar (hidden in mobile fullscreen) */}
      {!isMobileFullscreen && <MobileTabBar />}

      {/* Floating Toast Notification (iOS Dynamic Island Style at Top) */}
      {toastMessage && !isMobileFullscreen && (
        <div
          className="fixed inset-x-4 z-50 flex items-center justify-center pointer-events-none transition-all duration-300"
          style={{ top: "calc(max(env(safe-area-inset-top, 0px), 38px) + 3.25rem)" }}
        >
          <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-slate-900/90 dark:bg-black/90 backdrop-blur-xl border border-white/15 text-xs font-medium text-white shadow-xl animate-fade-in max-w-[90%]">
            <Sparkles className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            <span className="truncate">{toastMessage}</span>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileApp;
