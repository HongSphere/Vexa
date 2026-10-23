import React, { useRef, useState } from "react";
import {
  PackageOpen,
  Upload,
  Trash2,
  Sun,
  Moon,
  Monitor,
  RefreshCw,
  FileText,
  Clipboard,
  Globe,
  DownloadCloud,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from "lucide-react";
import { useAppStore } from "../../store/useAppStore";
import { checkAppUpdate, openExternalUrl, UpdateState } from "../../services/api";
import { ThemeMode } from "../../types/media";

export const MobileSettingsView: React.FC = () => {
  const {
    settings,
    updateSettings,
    sourcesConfig,
    importSources,
    importSourcesFromUrl,
    resetSources,
    showToast,
  } = useAppStore();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [showRemoteInput, setShowRemoteInput] = useState(false);
  const [showJsonText, setShowJsonText] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [showResetModal, setShowResetModal] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [showUpdateModal, setShowUpdateModal] = useState(false);
  const [updateState, setUpdateState] = useState<UpdateState>({
    checking: false,
    downloaded: false,
    version: null,
    error: false,
    message: "",
  });

  const siteCount = sourcesConfig.sites?.length || 0;
  const parseCount = sourcesConfig.parseLines?.length || 0;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (!content) return;
      try {
        await importSources(content);
        showToast("已成功导入规则配置文件");
      } catch (err: any) {
        showToast("导入失败: " + (err?.message || String(err)));
      }
    };
    reader.onerror = () => {
      showToast("文件读取失败，请尝试使用【粘贴文本】或【读取剪贴板】导入");
    };
    reader.readAsText(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };



  const handleRemoteImport = async () => {
    const url = remoteUrl.trim();
    if (!url) {
      showToast("请输入规则订阅 URL");
      return;
    }
    setIsLoading(true);
    try {
      await importSourcesFromUrl(url);
      showToast("已成功从远程订阅拉取规则");
      setRemoteUrl("");
      setShowRemoteInput(false);
    } catch (e: any) {
      showToast("拉取订阅失败: " + (e?.message || String(e)));
    } finally {
      setIsLoading(false);
    }
  };

  const handleJsonTextImport = async () => {
    const text = jsonText.trim();
    if (!text) {
      showToast("请先输入或粘贴 JSON 规则内容");
      return;
    }
    setIsLoading(true);
    try {
      await importSources(text);
      showToast("已成功导入规则配置");
      setJsonText("");
      setShowJsonText(false);
    } catch (err: any) {
      showToast("导入失败: " + (err?.message || String(err)));
    } finally {
      setIsLoading(false);
    }
  };

  const handleClipboardImport = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        showToast("剪贴板内容为空，请手动粘贴");
        setShowJsonText(true);
        return;
      }
      setIsLoading(true);
      await importSources(text.trim());
      showToast("已成功从剪贴板导入规则");
    } catch (err: any) {
      showToast("读取剪贴板失败，请手动长按粘贴");
      setShowJsonText(true);
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = async () => {
    await resetSources();
    setShowResetModal(false);
    showToast("已重置为初始配置");
  };

  const handleCheckUpdate = async () => {
    setUpdateState((s) => ({ ...s, checking: true, error: false, message: "正在检测新版本..." }));
    showToast("正在检测新版本...");
    try {
      const res = await checkAppUpdate(true);
      setUpdateState(res);
      showToast(res.message || "检测完成");
      if (res.version && res.version !== "1.0.0") {
        setShowUpdateModal(true);
      }
    } catch (e: any) {
      const msg = e?.message || "检查更新失败，请检查网络连接";
      setUpdateState((s) => ({ ...s, checking: false, error: true, message: msg }));
      showToast(msg);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4 select-none">
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".json,application/json,text/plain,text/json,application/octet-stream,*/*"
        className="hidden"
      />

      {/* Group 1: Sources & Rules */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-bold vx-muted uppercase px-1 tracking-wider">
          数据源与规则引擎
        </span>
        <div className="rounded-2xl vx-card border p-3.5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-sky-500/10 text-sky-500 flex items-center justify-center">
                <PackageOpen className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold vx-title">当前规则状态</div>
                <div className="text-[11px] vx-muted">
                  {siteCount > 0
                    ? `已载入 ${siteCount} 个站点 · ${parseCount} 条解析线路`
                    : "暂无配置数据"}
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons Grid (4 Options) */}
          <div className="grid grid-cols-4 gap-1.5 pt-1">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="py-2.5 px-1 rounded-xl bg-slate-100 dark:bg-white/5 border vx-text text-[11px] font-semibold flex flex-col items-center justify-center gap-1 active:scale-95 transition-all"
            >
              <Upload className="w-4 h-4 text-sky-500" />
              <span>导入文件</span>
            </button>

            <button
              onClick={handleClipboardImport}
              disabled={isLoading}
              className="py-2.5 px-1 rounded-xl bg-slate-100 dark:bg-white/5 border vx-text text-[11px] font-semibold flex flex-col items-center justify-center gap-1 active:scale-95 transition-all"
            >
              <Clipboard className="w-4 h-4 text-indigo-500" />
              <span>读剪贴板</span>
            </button>

            <button
              onClick={() => {
                setShowJsonText(!showJsonText);
                setShowRemoteInput(false);
              }}
              className={`py-2.5 px-1 rounded-xl border text-[11px] font-semibold flex flex-col items-center justify-center gap-1 active:scale-95 transition-all ${
                showJsonText
                  ? "bg-sky-500/15 border-sky-500/40 text-sky-400 font-bold"
                  : "bg-slate-100 dark:bg-white/5 vx-text"
              }`}
            >
              <FileText className="w-4 h-4 text-emerald-500" />
              <span>粘贴文本</span>
            </button>

            <button
              onClick={() => {
                setShowRemoteInput(!showRemoteInput);
                setShowJsonText(false);
              }}
              className={`py-2.5 px-1 rounded-xl border text-[11px] font-semibold flex flex-col items-center justify-center gap-1 active:scale-95 transition-all ${
                showRemoteInput
                  ? "bg-sky-500/15 border-sky-500/40 text-sky-400 font-bold"
                  : "bg-slate-100 dark:bg-white/5 vx-text"
              }`}
            >
              <Globe className="w-4 h-4 text-amber-500" />
              <span>网络订阅</span>
            </button>
          </div>

          {/* Paste JSON text area */}
          {showJsonText && (
            <div className="p-3 rounded-xl bg-black/[0.03] dark:bg-white/[0.04] border border-sky-500/20 space-y-2.5 animate-fade-in">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold vx-title">粘贴 JSON 规则内容</span>
                <button
                  onClick={handleClipboardImport}
                  className="text-[11px] text-sky-500 hover:text-sky-400 flex items-center gap-1 font-bold active:scale-95"
                >
                  <Clipboard className="w-3.5 h-3.5" />
                  <span>读取剪贴板</span>
                </button>
              </div>
              <textarea
                rows={4}
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                placeholder='在此粘贴 JSON 文本或配置代码：&#10;{"sites": [...], "vodProviders": [...]}'
                className="w-full p-2 text-xs font-mono rounded-xl vx-input resize-none focus:outline-none focus:border-sky-500"
              />
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setShowJsonText(false)}
                  className="px-3 py-1.5 text-xs rounded-xl vx-subtle border vx-muted"
                >
                  取消
                </button>
                <button
                  onClick={handleJsonTextImport}
                  disabled={isLoading}
                  className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-sky-500 text-white active:scale-95 shadow-sm disabled:opacity-50"
                >
                  {isLoading ? "解析中..." : "确认导入"}
                </button>
              </div>
            </div>
          )}

          {/* Remote URL input */}
          {showRemoteInput && (
            <div className="flex items-center gap-2 pt-1 animate-fade-in">
              <input
                type="text"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://example.com/sources.json"
                className="flex-1 py-1.5 px-2.5 text-xs rounded-xl vx-input"
              />
              <button
                onClick={handleRemoteImport}
                disabled={isLoading}
                className="px-3 py-1.5 rounded-xl bg-sky-500 text-white text-xs font-bold shrink-0"
              >
                {isLoading ? "拉取中" : "确认"}
              </button>
            </div>
          )}

          <div className="pt-1 border-t vx-divider flex justify-end">
            <button
              onClick={() => setShowResetModal(true)}
              className="text-[11px] text-rose-500 hover:text-rose-400 active:scale-95 flex items-center gap-1 py-1 px-2"
            >
              <Trash2 className="w-3 h-3" />
              <span>重置为初始配置</span>
            </button>
          </div>
        </div>
      </div>

      {/* Group 2: Appearance & Theme */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-bold vx-muted uppercase px-1 tracking-wider">
          界面外观模式
        </span>
        <div className="rounded-2xl vx-card border p-3 shadow-sm">
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-black/[0.04] dark:bg-white/[0.05] border border-black/[0.05] dark:border-white/[0.08]">
            {(["light", "dark", "system"] as ThemeMode[]).map((mode) => {
              const active = (settings.themeMode || "system") === mode;
              const labels: Record<ThemeMode, { title: string; icon: React.ReactNode }> = {
                light: { title: "浅色", icon: <Sun className="w-3.5 h-3.5" /> },
                dark: { title: "深色", icon: <Moon className="w-3.5 h-3.5" /> },
                system: { title: "跟随系统", icon: <Monitor className="w-3.5 h-3.5" /> },
              };
              return (
                <button
                  key={mode}
                  onClick={() => updateSettings({ themeMode: mode })}
                  className={`py-2 px-1 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    active
                      ? "bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm font-bold"
                      : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
                  }`}
                >
                  {labels[mode].icon}
                  <span>{labels[mode].title}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Group 3: Playback Preferences */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-bold vx-muted uppercase px-1 tracking-wider">
          播放与弹幕
        </span>
        <div className="rounded-2xl vx-card border divide-y vx-divider shadow-sm">
          {/* Danmaku switch */}
          <div className="p-3.5 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold vx-title">视频弹幕显示</div>
              <div className="text-[10px] vx-muted">开启后自动加载并滚动弹幕</div>
            </div>
            <button
              onClick={() => updateSettings({ danmakuEnabled: !settings.danmakuEnabled })}
              className={`w-12 h-7 rounded-full p-0.5 transition-colors duration-200 ${
                settings.danmakuEnabled ? "bg-sky-500" : "bg-slate-300 dark:bg-slate-700"
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full bg-white shadow-md transform transition-transform duration-200 ${
                  settings.danmakuEnabled ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          {/* Preferred quality */}
          <div className="p-3.5 flex items-center justify-between">
            <div>
              <div className="text-xs font-bold vx-title">默认优先画质</div>
              <div className="text-[10px] vx-muted">播放时优先自动匹配的分辨率</div>
            </div>
            <select
              value={settings.preferredQuality}
              onChange={(e) => updateSettings({ preferredQuality: parseInt(e.target.value) })}
              className="py-1 px-2 text-xs rounded-lg vx-subtle border vx-title font-semibold focus:outline-none"
            >
              <option value={1080}>1080P 超清</option>
              <option value={720}>720P 高清</option>
              <option value={480}>480P 标清</option>
            </select>
          </div>
        </div>
      </div>

      {/* Group 4: About & System */}
      <div className="space-y-1.5">
        <span className="text-[11px] font-bold vx-muted uppercase px-1 tracking-wider">
          关于软件
        </span>
        <div className="rounded-2xl vx-card border p-3.5 space-y-2.5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs font-bold vx-title">Vexa 跨平台流媒体工作台</div>
              <div className="text-[10px] font-mono vx-muted mt-0.5">
                版本 v1.0.0 (Tauri v2 + Rust)
              </div>
            </div>
            <button
              onClick={handleCheckUpdate}
              disabled={updateState.checking}
              className="px-3 py-1.5 rounded-xl vx-subtle border text-xs font-semibold vx-text flex items-center gap-1 active:scale-95"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${updateState.checking ? "animate-spin" : ""}`} />
              <span>{updateState.checking ? "检查中..." : "检查更新"}</span>
            </button>
          </div>

          {updateState.message && (
            <div className={`text-[11px] px-2.5 py-1.5 rounded-xl flex items-center gap-1.5 ${
              updateState.error
                ? "bg-rose-500/10 text-rose-500"
                : updateState.version && updateState.version !== "1.0.0"
                ? "bg-sky-500/10 text-sky-500 font-bold"
                : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
            }`}>
              {updateState.error ? (
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              ) : updateState.version && updateState.version !== "1.0.0" ? (
                <DownloadCloud className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              )}
              <span className="truncate">{updateState.message}</span>
            </div>
          )}
        </div>
      </div>

      {/* New Version Available Modal */}
      {showUpdateModal && updateState.version && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-xs bg-white dark:bg-[#181c26] rounded-2xl p-5 border vx-card shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-sky-500/15 border border-sky-500/30 text-sky-500 flex items-center justify-center mx-auto">
              <DownloadCloud className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold vx-title">发现新版本 v{updateState.version}</h3>
              <p className="text-xs vx-muted mt-1 leading-relaxed">
                建议升级以获取最新的功能优化、站点导航适配与性能体验。
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setShowUpdateModal(false)}
                className="flex-1 py-2 rounded-xl border vx-subtle text-xs font-semibold vx-text active:scale-95 transition-all"
              >
                稍后提醒
              </button>
              <button
                onClick={async () => {
                  const apkUrl = `https://github.com/HongSphere/Vexa/releases/download/v${updateState.version}/Vexa_${updateState.version}.apk`;
                  showToast("正在调用系统浏览器下载 APK...");
                  await openExternalUrl(apkUrl);
                  setShowUpdateModal(false);
                }}
                className="flex-1 py-2 rounded-xl bg-sky-500 active:bg-sky-600 text-white text-xs font-bold active:scale-95 shadow-md shadow-sky-500/25 transition-all flex items-center justify-center gap-1"
              >
                <span>立即下载</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Resetting Rules */}
      {showResetModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="w-full max-w-xs bg-white dark:bg-[#181c26] rounded-2xl p-5 border vx-card shadow-2xl space-y-4 text-center">
            <div className="w-12 h-12 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-500 flex items-center justify-center mx-auto">
              <Trash2 className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold vx-title">恢复默认规则配置？</h3>
              <p className="text-xs vx-muted mt-1 leading-relaxed">
                重置后将清除当前导入的所有站点和专线规则，恢复为出厂配置。
              </p>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                onClick={() => setShowResetModal(false)}
                className="flex-1 py-2 rounded-xl border vx-subtle text-xs font-semibold vx-text active:scale-95 transition-all"
              >
                取消
              </button>
              <button
                onClick={handleReset}
                className="flex-1 py-2 rounded-xl bg-rose-500 active:bg-rose-600 text-white text-xs font-bold active:scale-95 shadow-md shadow-rose-500/25 transition-all"
              >
                确认重置
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
