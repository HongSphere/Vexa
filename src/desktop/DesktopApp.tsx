import React from "react";
import { Sidebar } from "../components/Sidebar";
import { TopBar } from "../components/TopBar";
import { DiscoverView } from "../components/DiscoverView";
import { PlayerView } from "../components/PlayerView";
import { DownloadsView } from "../components/DownloadsView";
import { HistoryView } from "../components/HistoryView";
import { SettingsView } from "../components/SettingsView";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { useAppStore } from "../store/useAppStore";
import { Sparkles } from "lucide-react";

export const DesktopApp: React.FC = () => {
  const { activeTab, toastMessage } = useAppStore();

  return (
    <div className="flex h-screen w-screen overflow-hidden vx-app select-none transition-colors duration-200">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        <TopBar />

        <main className="flex-1 min-h-0 overflow-hidden relative">
          <ErrorBoundary key={activeTab}>
            {activeTab === "discover" && <DiscoverView />}
            {activeTab === "player" && <PlayerView />}
            {activeTab === "downloads" && <DownloadsView />}
            {activeTab === "history" && <HistoryView />}
            {activeTab === "settings" && <SettingsView />}
          </ErrorBoundary>
        </main>
      </div>

      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl vx-card border-sky-500/40 text-xs font-medium vx-title shadow-2xl">
          <Sparkles className="w-4 h-4 text-sky-500 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}
    </div>
  );
};

export default DesktopApp;
