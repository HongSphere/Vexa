import React, { useEffect } from "react";
import { DesktopApp } from "./desktop/DesktopApp";
import { MobileApp } from "./mobile/MobileApp";
import { useIsMobile } from "./hooks/useIsMobile";
import { useAppStore } from "./store/useAppStore";
import {
  actionPlatformWebview,
  getProxyPort,
  subscribeDownloadProgress,
  subscribePlatformWebviewUrl,
} from "./services/api";

export const App: React.FC = () => {
  const isMobile = useIsMobile();
  const {
    activeTab,
    setProxyPort,
    upsertDownloadTask,
    settings,
    setCurrentWebviewUrl,
    loadSourcesConfig,
  } = useAppStore();

  useEffect(() => {
    loadSourcesConfig().catch(() => {});
  }, [loadSourcesConfig]);

  // Manage Light / Dark / System Theme Mode on document.documentElement
  useEffect(() => {
    const root = document.documentElement;
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      const mode = settings.themeMode || "system";
      const isDark =
        mode === "dark" || (mode === "system" && mediaQuery.matches);
      if (isDark) {
        root.classList.remove("theme-light");
        root.classList.add("dark");
      } else {
        root.classList.add("theme-light");
        root.classList.remove("dark");
      }
    };

    applyTheme();
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [settings.themeMode]);

  // Hide embedded child webview whenever user leaves the discover tab
  useEffect(() => {
    if (activeTab !== "discover") {
      actionPlatformWebview("hide").catch(() => {});
    }
  }, [activeTab]);

  useEffect(() => {
    getProxyPort()
      .then((port) => setProxyPort(port))
      .catch(() => {});

    let unlistenDl: (() => void) | undefined;
    let unlistenWvUrl: (() => void) | undefined;

    subscribeDownloadProgress((task) => {
      upsertDownloadTask(task);
    }).then((fn) => {
      unlistenDl = fn;
    });

    subscribePlatformWebviewUrl((payload) => {
      if (payload?.url) {
        setCurrentWebviewUrl(payload.url);
      }
    }).then((fn) => {
      unlistenWvUrl = fn;
    });

    return () => {
      if (unlistenDl) unlistenDl();
      if (unlistenWvUrl) unlistenWvUrl();
    };
  }, []);

  return isMobile ? <MobileApp /> : <DesktopApp />;
};

export default App;
