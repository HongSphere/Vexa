import React, { useState } from "react";
import {
  History,
  Heart,
  Play,
  Trash2,
  Clock,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { formatDuration } from "../utils/format";

export const HistoryView: React.FC = () => {
  const {
    history,
    clearHistory,
    deleteHistoryItem,
    loadAndPlayUrl,
    toggleFavorite,
    showToast,
  } = useAppStore();
  const [filter, setFilter] = useState<"all" | "favorites">("all");

  const list =
    filter === "favorites"
      ? history.filter((h) => h.isFavorite)
      : history;

  return (
    <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 h-full overflow-y-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold vx-title">观看历史与我的收藏</h1>
          <p className="text-xs vx-muted mt-0.5">
            自动记住每个视频上次看到的进度，点击即可接着上次位置继续看
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1 vx-card p-1 rounded-xl">
            <button
              onClick={() => setFilter("all")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                filter === "all"
                  ? "bg-sky-500 text-white shadow-sm"
                  : "vx-muted hover:vx-title"
              }`}
            >
              <History className="w-3.5 h-3.5" />
              <span>全部记录 ({history.length})</span>
            </button>
            <button
              onClick={() => setFilter("favorites")}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
                filter === "favorites"
                  ? "bg-rose-500 text-white shadow-sm"
                  : "vx-muted hover:vx-title"
              }`}
            >
              <Heart className="w-3.5 h-3.5" />
              <span>
                我的收藏 ({history.filter((h) => h.isFavorite).length})
              </span>
            </button>
          </div>

          {history.length > 0 && (
            <button
              onClick={() => {
                clearHistory();
                showToast("已清空历史记录");
              }}
              className="px-3.5 py-2 rounded-xl vx-subtle hover:bg-rose-500/15 vx-text hover:text-rose-500 text-xs font-medium flex items-center gap-1.5 border"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>清空记录</span>
            </button>
          )}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="vx-card rounded-2xl py-20 flex flex-col items-center justify-center text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl vx-subtle border flex items-center justify-center vx-muted">
            <Clock className="w-6 h-6" />
          </div>
          <div className="text-sm font-semibold vx-title">
            {filter === "favorites"
              ? "您还没有收藏过视频"
              : "暂无观看历史记录"}
          </div>
          <p className="text-xs vx-muted">
            通过视频播放器看过的每一部视频都会自动记录进度，方便下次打开接着看。
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {list.map((item) => {
            const percent =
              item.duration > 0
                ? Math.min(100, Math.round((item.lastPosition / item.duration) * 100))
                : 0;
            return (
              <div
                key={item.id + item.url}
                className="vx-card-interactive rounded-2xl overflow-hidden flex flex-col justify-between group"
              >
                <div
                  onClick={() => loadAndPlayUrl(item.url, item.lastPosition)}
                  className="cursor-pointer"
                >
                  <div className="relative aspect-video bg-slate-900">
                    <img
                      src={item.thumbnail}
                      alt={item.title}
                      referrerPolicy="no-referrer"
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
                    <span className="absolute top-2.5 left-2.5 px-2 py-0.5 rounded bg-black/75 text-sky-300 text-[11px] font-semibold">
                      {item.platformName}
                    </span>
                    <div className="absolute bottom-2.5 left-2.5 right-2.5 flex items-center justify-between text-xs text-white">
                      <span className="px-2 py-0.5 rounded bg-sky-500/90 font-semibold">
                        上次看到 {formatDuration(item.lastPosition)}
                      </span>
                      <span className="font-mono text-slate-200">
                        共 {formatDuration(item.duration)}
                      </span>
                    </div>
                    <div className="absolute bottom-0 inset-x-0 h-1 bg-white/20">
                      <div
                        className="h-full bg-sky-400"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>

                  <div className="p-4 space-y-1.5">
                    <h3 className="text-sm font-semibold vx-title group-hover:text-sky-500 line-clamp-2 transition-colors">
                      {item.title}
                    </h3>
                    <p className="text-xs vx-muted">{item.uploader}</p>
                  </div>
                </div>

                <div className="px-4 pb-3.5 pt-2.5 border-t vx-divider flex items-center justify-between">
                  <button
                    onClick={() => loadAndPlayUrl(item.url, item.lastPosition)}
                    className="px-3.5 py-1.5 rounded-lg bg-sky-500/15 hover:bg-sky-500 text-sky-500 hover:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>继续观看</span>
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => toggleFavorite(item)}
                      className={`p-1.5 rounded-lg transition-colors ${
                        item.isFavorite
                          ? "text-rose-500"
                          : "vx-muted hover:text-rose-500"
                      }`}
                      title={item.isFavorite ? "取消收藏" : "加入收藏"}
                    >
                      <Heart
                        className={`w-4 h-4 ${
                          item.isFavorite ? "fill-rose-500" : ""
                        }`}
                      />
                    </button>
                    <button
                      onClick={() => {
                        deleteHistoryItem(item.id);
                        showToast("已删除该条记录");
                      }}
                      className="p-1.5 rounded-lg vx-muted hover:text-rose-500 transition-colors"
                      title="删除记录"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
