import React from "react";
import {
  Globe,
  PlayCircle,
  Download,
  History,
  Settings,
} from "lucide-react";
import { VexaLogo } from "./VexaLogo";
import { NavTab, useAppStore } from "../store/useAppStore";

export const Sidebar: React.FC = () => {
  const { activeTab, setActiveTab, downloads } = useAppStore();

  const activeDownloadCount = downloads.filter(
    (d) =>
      d.status === "queued" ||
      d.status === "downloading_video" ||
      d.status === "downloading_audio" ||
      d.status === "merging"
  ).length;

  const navItems: {
    id: NavTab;
    label: string;
    icon: React.ReactNode;
    badge?: number | string;
  }[] = [
    {
      id: "discover",
      label: "网站导航",
      icon: <Globe className="w-[18px] h-[18px]" />,
    },
    {
      id: "player",
      label: "视频播放器",
      icon: <PlayCircle className="w-[18px] h-[18px]" />,
    },
    {
      id: "downloads",
      label: "下载管理",
      icon: <Download className="w-[18px] h-[18px]" />,
      badge: activeDownloadCount > 0 ? activeDownloadCount : undefined,
    },
    {
      id: "history",
      label: "历史与收藏",
      icon: <History className="w-[18px] h-[18px]" />,
    },
    {
      id: "settings",
      label: "软件设置",
      icon: <Settings className="w-[18px] h-[18px]" />,
    },
  ];

  return (
    <aside className="w-44 shrink-0 vx-sidebar border-r flex flex-col justify-between h-full select-none transition-colors duration-200">
      <div>
        {/* Brand Header */}
        <div className="px-4 h-14 flex items-center gap-2.5 border-b vx-divider">
          <div className="w-8 h-8 rounded-[9px] border border-slate-300/80 dark:border-white/15 shadow-sm overflow-hidden shrink-0 flex items-center justify-center bg-white dark:bg-slate-900">
            <VexaLogo className="w-full h-full" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="text-base font-bold tracking-tight vx-title">
              Vexa
            </span>
            <span className="text-[11px] font-mono vx-muted">v1.0.0</span>
          </div>
        </div>

        {/* Navigation Menu */}
        <nav className="p-2.5 space-y-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`relative w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-sky-500/15 text-sky-500 font-semibold"
                    : "vx-text hover:bg-sky-500/[0.07]"
                }`}
              >
                {isActive && (
                  <span className="absolute left-0 top-2 bottom-2 w-1 rounded-r-full bg-sky-500" />
                )}
                <div className="flex items-center gap-2.5">
                  <span className={isActive ? "text-sky-500" : "vx-muted"}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </div>

                {item.badge !== undefined && (
                  <span className="px-1.5 py-0.5 text-[11px] font-bold rounded-full bg-sky-500 text-white leading-none">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Bottom Status */}
      <div className="px-4 py-3 border-t vx-divider flex items-center gap-2 text-[11px] vx-muted">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
        <span>多源聚合 · 高清播放</span>
      </div>
    </aside>
  );
};
