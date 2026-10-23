import React, { useState } from "react";
import { History, Heart, Trash2, Film } from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { formatDuration } from "../../utils/format";

export const MobileHistoryView: React.FC = () => {
  const {
    history,
    clearHistory,
    deleteHistoryItem,
    toggleFavorite,
    loadAndPlayUrl,
    showToast,
  } = useAppStore();

  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const [showClearModal, setShowClearModal] = useState(false);

  const list =
    filter === "favorites"
      ? history.filter((h) => h.isFavorite)
      : history;

  return (
    <div className="h-full flex flex-col overflow-hidden p-3.5 space-y-3">
      {/* Top Filter & Clear Bar */}
      <div className="flex items-center justify-between gap-2 shrink-0">
        <div className="flex items-center p-1 rounded-2xl bg-black/[0.04] dark:bg-white/[0.05] border border-black/[0.05] dark:border-white/[0.08] flex-1">
          <button
            onClick={() => setFilter("all")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-xl transition-all ${
              filter === "all"
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm font-bold"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            全部历史 ({history.length})
          </button>
          <button
            onClick={() => setFilter("favorites")}
            className={`flex-1 py-1.5 text-xs font-semibold rounded-xl transition-all ${
              filter === "favorites"
                ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm font-bold"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            }`}
          >
            我的收藏 ({history.filter((h) => h.isFavorite).length})
          </button>
        </div>

        {filter === "all" && history.length > 0 && (
          <button
            onClick={() => setShowClearModal(true)}
            className="p-2 rounded-xl vx-subtle border text-xs vx-muted hover:text-rose-400 active:scale-95 transition-transform"
            title="清空全部记录"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* History Items List */}
      <div className="flex-1 overflow-y-auto space-y-2.5">
        {list.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-xs vx-muted space-y-3">
            <div className="w-14 h-14 rounded-3xl vx-subtle border flex items-center justify-center text-sky-500">
              <History className="w-6 h-6" />
            </div>
            <p className="max-w-xs">
              {filter === "all"
                ? "暂无观看历史，播放视频后将自动在此记录"
                : "还没有收藏任何视频"}
            </p>
          </div>
        ) : (
          list.map((item) => {
            const percent =
              item.duration > 0
                ? Math.min(100, Math.round((item.lastPosition / item.duration) * 100))
                : 0;

            return (
              <div
                key={item.id}
                onClick={() => loadAndPlayUrl(item.url, item.lastPosition)}
                className="p-2.5 rounded-2xl vx-card border flex items-center gap-3 active:scale-[0.99] transition-all cursor-pointer shadow-sm group"
              >
                {/* 16:9 Thumbnail with Progress Indicator */}
                <div className="w-24 h-14 rounded-xl overflow-hidden bg-slate-900 shrink-0 relative border border-white/5">
                  {item.thumbnail ? (
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-600">
                      <Film className="w-5 h-5" />
                    </div>
                  )}

                  {/* Duration Badge */}
                  {item.duration > 0 && (
                    <span className="absolute bottom-1 right-1 px-1 py-0.2 rounded bg-black/80 text-[9px] font-mono text-white">
                      {formatDuration(item.duration)}
                    </span>
                  )}

                  {/* Watched Progress Line */}
                  <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
                    <div
                      className="h-full bg-sky-500"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>

                {/* Details */}
                <div className="min-w-0 flex-1 space-y-1">
                  <h3 className="text-xs font-bold vx-title truncate">
                    {item.title}
                  </h3>
                  <div className="flex items-center gap-2 text-[10px] vx-muted">
                    <span className="px-1.5 py-0.2 rounded bg-sky-500/10 text-sky-500 font-semibold">
                      {item.platformName || "视频"}
                    </span>
                    <span>
                      {item.lastPosition > 0
                        ? `看至 ${formatDuration(item.lastPosition)} (${percent}%)`
                        : "刚开始播放"}
                    </span>
                  </div>
                </div>

                {/* Actions: Favorite & Delete */}
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavorite(item);
                    }}
                    className={`p-2 rounded-xl vx-subtle border active:scale-90 transition-transform ${
                      item.isFavorite
                        ? "text-rose-500"
                        : "vx-muted hover:vx-title"
                    }`}
                    title="收藏"
                  >
                    <Heart
                      className={`w-4 h-4 ${item.isFavorite ? "fill-current" : ""}`}
                    />
                  </button>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteHistoryItem(item.id);
                      showToast("已删除该条记录");
                    }}
                    className="p-2 rounded-xl vx-subtle border text-slate-400 hover:text-rose-500 active:scale-90 transition-transform"
                    title="删除记录"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Confirmation Modal for Clearing All History */}
      {showClearModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-xs bg-white dark:bg-[#181c26] rounded-2xl p-5 border vx-card shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-500 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold vx-title">确定清空历史记录？</h3>
              <p className="text-xs vx-muted mt-1 leading-relaxed">
                清空后将移除所有播放进度，收藏的视频仍会保留。
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setShowClearModal(false)}
                className="flex-1 py-2 rounded-xl border vx-subtle text-xs font-semibold vx-text active:scale-95 transition-all"
              >
                取消
              </button>
              <button
                onClick={() => {
                  clearHistory();
                  setShowClearModal(false);
                  showToast("已清空全部历史记录");
                }}
                className="flex-1 py-2 rounded-xl bg-rose-500 active:bg-rose-600 text-white text-xs font-bold active:scale-95 shadow-md shadow-rose-500/25 transition-all"
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
