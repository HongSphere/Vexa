import React, { useState } from "react";
import {
  Download,
  FolderOpen,
  Play,
  Pause,
  Trash2,
  CheckCircle2,
  Loader2,
  AlertCircle,
  RotateCcw,
  Film,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import { controlDownloadTask } from "../services/api";
import { DownloadStatus, DownloadTask } from "../types/media";

function getStatusText(status: DownloadStatus): string {
  switch (status) {
    case "queued":
      return "排队等待中...";
    case "downloading_video":
      return "正在高速下载视频流...";
    case "downloading_audio":
      return "正在下载高码率音频流...";
    case "merging":
      return "正在无损合并音视频切片...";
    case "completed":
      return "已下载完成";
    case "paused":
      return "已暂停（支持断点续传）";
    case "failed":
      return "下载中断";
  }
}

export const DownloadsView: React.FC = () => {
  const {
    downloads,
    removeDownloadTask,
    upsertDownloadTask,
    loadAndPlayUrl,
    settings,
    showToast,
  } = useAppStore();

  const [tab, setTab] = useState<"active" | "completed">("active");

  const activeList = downloads.filter((d) => d.status !== "completed");
  const completedList = downloads.filter((d) => d.status === "completed");

  const displayedList = tab === "active" ? activeList : completedList;

  const handleControl = async (
    task: DownloadTask,
    action: "pause" | "resume" | "cancel" | "open_folder"
  ) => {
    if (action === "cancel") {
      await controlDownloadTask(task.id, "cancel");
      removeDownloadTask(task.id);
      showToast("已移除下载任务");
      return;
    }
    if (action === "pause") {
      await controlDownloadTask(task.id, "pause");
      upsertDownloadTask({ ...task, status: "paused", speed: "0 KB/s" });
      return;
    }
    if (action === "resume") {
      await controlDownloadTask(task.id, "resume");
      upsertDownloadTask({ ...task, status: "downloading_video" });
      return;
    }
    if (action === "open_folder") {
      await controlDownloadTask(task.id, "open_folder");
      showToast(`已打开保存目录：${task.outputPath || settings.downloadDir}`);
    }
  };

  return (
    <div className="p-3.5 sm:p-6 space-y-4 sm:space-y-5 h-full overflow-y-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold vx-title">下载管理</h1>
          <p className="text-xs vx-muted mt-0.5">
            默认保存文件夹：{settings.downloadDir}（支持多线程断点续传与媒体流自动合成）
          </p>
        </div>

        {/* Sub-Tabs */}
        <div className="flex items-center gap-1.5 vx-card p-1 rounded-xl">
          <button
            onClick={() => setTab("active")}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              tab === "active"
                ? "bg-sky-500 text-white shadow-sm"
                : "vx-muted hover:vx-title"
            }`}
          >
            正在下载 ({activeList.length})
          </button>
          <button
            onClick={() => setTab("completed")}
            className={`px-4 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              tab === "completed"
                ? "bg-emerald-500 text-slate-950 font-bold shadow-sm"
                : "vx-muted hover:vx-title"
            }`}
          >
            已完成 ({completedList.length})
          </button>
        </div>
      </div>

      {/* Task List */}
      {displayedList.length === 0 ? (
        <div className="vx-card rounded-2xl py-20 flex flex-col items-center justify-center text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl vx-subtle border flex items-center justify-center vx-muted">
            <Download className="w-6 h-6" />
          </div>
          <div className="text-sm font-semibold vx-title">
            {tab === "active"
              ? "当前没有正在进行的下载任务"
              : "还没有已下载完成的视频"}
          </div>
          <p className="text-xs vx-muted max-w-sm">
            在浏览网页视频时，点击顶部工具栏右侧的「下载视频」即可一键保存到本地。
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayedList.map((task) => (
            <div
              key={task.id}
              className="vx-card rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
            >
              <div className="flex items-center gap-4 min-w-0 flex-1">
                {task.thumbnail ? (
                  <img
                    src={task.thumbnail}
                    alt={task.title}
                    referrerPolicy="no-referrer"
                    className="w-32 aspect-video rounded-xl object-cover bg-slate-900 shrink-0 border vx-divider"
                  />
                ) : (
                  <div className="w-32 aspect-video rounded-xl vx-subtle border flex items-center justify-center text-sky-500 shrink-0">
                    <Film className="w-6 h-6" />
                  </div>
                )}

                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-sky-500/15 text-sky-500 text-[11px] font-semibold">
                      {task.qualityLabel}
                    </span>
                    <span className="text-xs vx-muted">
                      {task.platformName}
                    </span>
                  </div>

                  <h3 className="text-sm font-semibold vx-title truncate">
                    {task.title}
                  </h3>

                  {/* Progress Bar */}
                  {task.status !== "completed" ? (
                    <div className="space-y-1.5">
                      <div className="w-full h-2 vx-subtle rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-sky-500 to-emerald-400 transition-all duration-300"
                          style={{ width: `${Math.min(100, task.progress)}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs vx-muted">
                        <span className="flex items-center gap-1.5">
                          {(task.status === "downloading_video" ||
                            task.status === "downloading_audio" ||
                            task.status === "merging") && (
                            <Loader2 className="w-3.5 h-3.5 text-sky-500 animate-spin" />
                          )}
                          {task.status === "failed" && (
                            <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                          )}
                          <span>{getStatusText(task.status)}</span>
                        </span>
                        <span className="font-mono">
                          {task.progress.toFixed(1)}% · {task.speed} · 剩余{" "}
                          {task.eta}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-emerald-500 font-medium">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>
                        已完成合并 · 保存在 {task.outputPath || settings.downloadDir}
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                {task.status === "completed" ? (
                  <>
                    <button
                      onClick={() => loadAndPlayUrl(task.url)}
                      className="px-3.5 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold flex items-center gap-1.5"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>直接播放</span>
                    </button>
                    <button
                      onClick={() => handleControl(task, "open_folder")}
                      className="px-3.5 py-2 rounded-xl vx-subtle border vx-text text-xs font-medium flex items-center gap-1.5"
                    >
                      <FolderOpen className="w-3.5 h-3.5 text-amber-500" />
                      <span>打开文件夹</span>
                    </button>
                  </>
                ) : task.status === "paused" || task.status === "failed" ? (
                  <button
                    onClick={() => handleControl(task, "resume")}
                    className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>继续下载</span>
                  </button>
                ) : (
                  <button
                    onClick={() => handleControl(task, "pause")}
                    className="px-3.5 py-2 rounded-xl vx-subtle border vx-text text-xs font-medium flex items-center gap-1.5"
                  >
                    <Pause className="w-3.5 h-3.5" />
                    <span>暂停</span>
                  </button>
                )}

                <button
                  onClick={() => handleControl(task, "cancel")}
                  className="p-2 rounded-xl vx-subtle hover:bg-rose-500/15 vx-muted hover:text-rose-500 transition-colors"
                  title="删除任务"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
