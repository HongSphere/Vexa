import React from "react";
import { useAppStore } from "../store/useAppStore";
import { MobileHeader } from "./components/MobileHeader";
import { MobileTabBar } from "./components/MobileTabBar";
import { MobileDiscoverView } from "./views/MobileDiscoverView";
import { MobilePlayerView } from "./views/MobilePlayerView";
import { MobileDownloadsView } from "./views/MobileDownloadsView";
import { MobileHistoryView } from "./views/MobileHistoryView";
import { MobileSettingsView } from "./views/MobileSettingsView";
import { Sparkles } from "lucide-react";

export const MobileApp: React.FC = () => {
  const { activeTab, toastMessage, isMobileFullscreen } = useAppStore();

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden vx-app select-none transition-colors duration-200">
      {/* Dedicated Mobile Header (hidden in mobile fullscreen) */}
      {!isMobileFullscreen && <MobileHeader />}

      {/* Main Viewport: 100% full-width, touch-optimized views */}
      <main className="flex-1 min-h-0 overflow-hidden relative">
        {activeTab === "discover" && <MobileDiscoverView />}
        {activeTab === "player" && <MobilePlayerView />}
        {activeTab === "downloads" && <MobileDownloadsView />}
        {activeTab === "history" && <MobileHistoryView />}
        {activeTab === "settings" && <MobileSettingsView />}
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
