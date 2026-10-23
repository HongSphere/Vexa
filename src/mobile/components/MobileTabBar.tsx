import React from "react";
import {
  Compass,
  PlayCircle,
  ArrowDownCircle,
  Clock,
  SlidersHorizontal,
} from "lucide-react";
import { NavTab, useAppStore } from "../../store/useAppStore";

export const MobileTabBar: React.FC = () => {
  const { activeTab, setActiveTab, downloads } = useAppStore();

  const activeDownloadCount = downloads.filter(
    (d) =>
      d.status === "queued" ||
      d.status === "downloading_video" ||
      d.status === "downloading_audio" ||
      d.status === "merging"
  ).length;

  const tabs: {
    id: NavTab;
    label: string;
    icon: (isActive: boolean) => React.ReactNode;
    badge?: number;
  }[] = [
    {
      id: "discover",
      label: "导航",
      icon: (active) => (
        <Compass
          className="w-[21px] h-[21px] transition-transform duration-200"
          strokeWidth={active ? 2.2 : 1.6}
        />
      ),
    },
    {
      id: "player",
      label: "播放",
      icon: (active) => (
        <PlayCircle
          className="w-[21px] h-[21px] transition-transform duration-200"
          strokeWidth={active ? 2.2 : 1.6}
        />
      ),
    },
    {
      id: "downloads",
      label: "下载",
      icon: (active) => (
        <ArrowDownCircle
          className="w-[21px] h-[21px] transition-transform duration-200"
          strokeWidth={active ? 2.2 : 1.6}
        />
      ),
      badge: activeDownloadCount > 0 ? activeDownloadCount : undefined,
    },
    {
      id: "history",
      label: "历史",
      icon: (active) => (
        <Clock
          className="w-[21px] h-[21px] transition-transform duration-200"
          strokeWidth={active ? 2.2 : 1.6}
        />
      ),
    },
    {
      id: "settings",
      label: "设置",
      icon: (active) => (
        <SlidersHorizontal
          className="w-[21px] h-[21px] transition-transform duration-200"
          strokeWidth={active ? 2.2 : 1.6}
        />
      ),
    },
  ];

  return (
    <nav
      onWheel={(e) => {
        if (e.deltaY !== 0) e.currentTarget.scrollLeft += e.deltaY;
      }}
      className="shrink-0 bg-white/80 dark:bg-[#0b0d13]/85 backdrop-blur-2xl border-t border-black/[0.06] dark:border-white/[0.08] flex items-center justify-around px-3 pt-2 z-40 select-none transition-colors overflow-x-auto no-scrollbar scroll-smooth"
      style={{
        touchAction: "pan-x",
        WebkitOverflowScrolling: "touch",
        paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)",
      }}
    >
      {tabs.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative flex flex-col items-center justify-center flex-1 min-w-[56px] py-1 gap-1 transition-all duration-150 active:scale-90 ${
              isActive
                ? "text-sky-500 dark:text-sky-400 font-bold"
                : "text-slate-400 dark:text-slate-500 hover:text-slate-600 dark:hover:text-slate-300"
            }`}
          >
            <div className="relative">
              <span
                className={`transition-all duration-200 block ${
                  isActive ? "scale-105" : "scale-100 opacity-90"
                }`}
              >
                {tab.icon(isActive)}
              </span>
              {tab.badge !== undefined && (
                <span className="absolute -top-1 -right-2 px-1 min-w-[15px] h-[15px] text-[9px] font-black rounded-full bg-rose-500 text-white flex items-center justify-center leading-none shadow-sm">
                  {tab.badge}
                </span>
              )}
            </div>

            <span
              className={`text-[10px] tracking-tight leading-none transition-all ${
                isActive ? "font-bold" : "font-medium opacity-85"
              }`}
            >
              {tab.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
};
