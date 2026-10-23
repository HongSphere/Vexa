import React, { useState } from "react";
import {
  Download,
  FolderOpen,
  Play,
  Pause,
  Trash2,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { controlDownloadTask } from "../../services/api";
import { DownloadStatus, DownloadTask } from "../../types/media";

function getStatusBadge(status: DownloadStatus) {
  switch (status) {
    case "queued":
      return <span className="text-amber-500 font-medium">排队中</span>;
    case "downloading_video":
      return <span className="text-sky-500 font-semibold">下载视频中</span>;
    case "downloading_audio":
      return <span className="text-sky-500 font-semibold">下载音频中</span>;
    case "merging":
      return <span className="text-indigo-400 font-semibold">合并切片中</span>;
    case "completed":
      return <span className="text-emerald-500 font-semibold">已完成</span>;
    case "paused":
      return <span className="text-slate-400">已暂停</span>;
    case "failed":
      return <span className="text-rose-500">下载失败</span>;
  }
}

export const MobileDownloadsView: React.FC = () => {
  const { downloads, removeDownloadTask, upsertDownloadTask, loadAndPlayUrl, showToast } =
    useAppStore();

  const [filter, setFilter] = useState<"active" | "completed">("active");

  const activeList = downloads.filter((d) => d.status !== "completed");
  const completedList = downloads.filter((d) => d.status === "completed");
  const displayedList = filter === "active" ? activeList : completedList;

  const handleControl = async (
    task: DownloadTask,
    action: "pause" | "resume" | "cancel" | "open_folder"
  ) => {
    if (action === "cancel") {
      await controlDownloadTask(task.id, "cancel");
      removeDownloadTask(task.id);
      showToast("已取消下载");
      return;
    }
    if (action === "pause") {
      await controlDownloadTask(task.id, "pause");
      upsertDownloadTask({ ...task, status: "paused", speed: "0 KB/s" });
      return;
    }
    if (action === "resume") {
      await controlDownloadTask(task.id, "resume");
      upsertDownloadTask({ ...task, status: "queued" });
      return;
    }
    if (action === "open_folder") {
      await controlDownloadTask(task.id, "open_folder");
      showToast("已打开文件位置");
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden p-3.5 space-y-3">
      {/* Segmented Filter Pills */}
      <div className="flex items-center p-1 rounded-2xl bg-black/[0.04] dark:bg-white/[0.05] border border-black/[0.05] dark:border-white/[0.08] shrink-0">
        <button
          onClick={() => setFilter("active")}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-xl transition-all ${
            filter === "active"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm font-bold"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          正在下载 ({activeList.length})
        </button>
        <button
          onClick={() => setFilter("completed")}
          className={`flex-1 py-1.5 text-xs font-semibold rounded-xl transition-all ${
            filter === "completed"
              ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm font-bold"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          已完成 ({completedList.length})
        </button>
      </div>

      {/* Task List */}
      <div className="flex-1 overflow-y-auto space-y-2.5">
        {displayedList.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-8 text-xs vx-muted space-y-3">
            <div className="w-14 h-14 rounded-3xl vx-subtle border flex items-center justify-center text-sky-500">
              <Download className="w-6 h-6" />
            </div>
            <p className="max-w-xs">
              {filter === "active"
                ? "当前没有正在下载的任务"
                : "还没有下载完成的视频"}
            </p>
          </div>
        ) : (
          displayedList.map((task) => {
            const isCompleted = task.status === "completed";
            const percent = Math.min(100, Math.round(task.progress || 0));

            return (
              <div
                key={task.id}
                className="p-3.5 rounded-2xl vx-card border space-y-2.5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <h3 className="text-xs font-bold vx-title truncate">
                      {task.title}
                    </h3>
                    <div className="flex items-center gap-2 text-[10px] mt-0.5">
                      {getStatusBadge(task.status)}
                      {task.speed && task.status !== "completed" && task.status !== "paused" && (
                        <span className="font-mono text-sky-400">
                          {task.speed}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 shrink-0">
                    {isCompleted ? (
                      <>
                        <button
                          onClick={() => loadAndPlayUrl(task.outputPath || task.url)}
                          className="p-1.5 rounded-xl bg-sky-500 text-white active:scale-90 transition-transform"
                          title="播放"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                        </button>
                        <button
                          onClick={() => handleControl(task, "open_folder")}
                          className="p-1.5 rounded-xl vx-subtle border vx-muted hover:vx-title active:scale-90 transition-transform"
                          title="定位文件"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => {
                            removeDownloadTask(task.id);
                            showToast("已移除该下载记录");
                          }}
                          className="p-1.5 rounded-xl vx-subtle border text-slate-400 hover:text-rose-500 active:scale-90 transition-transform"
                          title="删除记录"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <>
                        {task.status === "paused" ? (
                          <button
                            onClick={() => handleControl(task, "resume")}
                            className="p-1.5 rounded-xl bg-sky-500 text-white active:scale-90 transition-transform"
                            title="继续"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                          </button>
                        ) : (
                          <button
                            onClick={() => handleControl(task, "pause")}
                            className="p-1.5 rounded-xl vx-subtle border vx-muted hover:vx-title active:scale-90 transition-transform"
                            title="暂停"
                          >
                            <Pause className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          onClick={() => handleControl(task, "cancel")}
                          className="p-1.5 rounded-xl vx-subtle border text-rose-400 hover:text-rose-500 active:scale-90 transition-transform"
                          title="取消"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Progress bar */}
                {!isCompleted && (
                  <div className="space-y-1">
                    <div className="w-full h-1.5 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-sky-500 rounded-full transition-all duration-300"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] vx-muted font-mono">
                      <span>{percent}%</span>
                      {task.eta ? <span>约剩 {task.eta}</span> : null}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
