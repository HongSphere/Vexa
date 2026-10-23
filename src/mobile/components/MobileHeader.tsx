import React from "react";
import { NavTab, useAppStore } from "../../store/useAppStore";
import { Moon, Sun } from "lucide-react";

const TAB_TITLES: Record<NavTab, string> = {
  discover: "网站导航",
  player: "媒体播放",
  downloads: "离线下载",
  history: "历史与收藏",
  settings: "系统设置",
};

interface MobileHeaderProps {
  rightAction?: React.ReactNode;
}

export const MobileHeader: React.FC<MobileHeaderProps> = ({ rightAction }) => {
  const { activeTab, settings, updateSettings } = useAppStore();

  const toggleTheme = () => {
    const next = settings.themeMode === "dark" ? "light" : "dark";
    updateSettings({ themeMode: next });
  };

  return (
    <header
      data-tauri-drag-region
      className="shrink-0 bg-white/85 dark:bg-[#0b0d13]/90 backdrop-blur-2xl border-b border-black/[0.06] dark:border-white/[0.08] px-3.5 flex items-center justify-between select-none z-30 transition-colors"
      style={{
        paddingTop: "max(env(safe-area-inset-top, 0px), 38px)",
        paddingBottom: "10px",
        minHeight: "calc(2.6rem + max(env(safe-area-inset-top, 0px), 38px))",
      }}
    >
      {/* Brand & Minimalist Title */}
      <div className="flex items-center gap-1.5 pointer-events-none" data-tauri-drag-region>
        <span className="text-[15px] font-black tracking-tight text-slate-900 dark:text-white">
          Vexa
        </span>
        <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
        <span className="text-xs font-medium text-slate-400 dark:text-slate-500 ml-1">
          {TAB_TITLES[activeTab]}
        </span>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-1" data-tauri-drag-region="false">
        {rightAction}

        <button
          onClick={toggleTheme}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-black/5 dark:hover:bg-white/5 active:scale-90 transition-all"
          title="切换外观主题"
        >
          {settings.themeMode === "light" ? (
            <Sun className="w-3.5 h-3.5 text-amber-500 stroke-[2]" />
          ) : (
            <Moon className="w-3.5 h-3.5 text-sky-400 stroke-[2]" />
          )}
        </button>
      </div>
    </header>
  );
};
