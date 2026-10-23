import React, { useEffect, useRef, useState } from "react";
import {
  Folder,
  Sparkles,
  RefreshCw,
  ArrowDownCircle,
  Tv,
  Sun,
  Moon,
  Monitor,
  Palette,
  ChevronDown,
  PackageOpen,
  Upload,
  Download,
  Trash2,
  Globe,
  FileCode,
  CheckCircle2,
  AlertCircle,
  Link,
  ChevronUp,
} from "lucide-react";
import { useAppStore } from "../store/useAppStore";
import {
  checkAppUpdate,
  getUpdaterState,
  installAppUpdate,
  subscribeUpdaterState,
  UpdateState,
} from "../services/api";
import { ThemeMode } from "../types/media";

export const SettingsView: React.FC = () => {
  const {
    settings,
    updateSettings,
    showToast,
    sourcesConfig,
    loadSourcesConfig,
    importSources,
    importSourcesFromUrl,
    resetSources,
  } = useAppStore();

  const [updateState, setUpdateState] = useState<UpdateState>({
    checking: false,
    downloaded: false,
    version: null,
    error: false,
    message: "当前已是最新版本",
  });

  const [remoteUrlInput, setRemoteUrlInput] = useState("");
  const [showRemoteInput, setShowRemoteInput] = useState(false);
  const [showJsonModal, setShowJsonModal] = useState(false);
  const [jsonText, setJsonText] = useState("");
  const [showRulesPreview, setShowRulesPreview] = useState(false);
  const [isLoadingSources, setIsLoadingSources] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadSourcesConfig().catch(() => {});
    getUpdaterState()
      .then((s) => {
        if (s.message) setUpdateState(s);
      })
      .catch(() => {});

    let unlisten: (() => void) | undefined;
    subscribeUpdaterState((s) => {
      setUpdateState(s);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [loadSourcesConfig]);

  const handleUpdateAction = async () => {
    if (updateState.checking) return;
    if (updateState.downloaded) {
      showToast("正在安装新版本并重启 Vexa...");
      await installAppUpdate();
      return;
    }
    try {
      const res = await checkAppUpdate(true);
      setUpdateState(res);
      if (res.downloaded) {
        showToast(
          `发现新版本 v${res.version} 并已下载完成，点击「立即安装并重启」即可生效`
        );
      } else if (res.message) {
        showToast(res.message);
      }
    } catch (e: any) {
      showToast(e?.message || "检查更新失败");
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (evt) => {
      try {
        const text = evt.target?.result as string;
        await importSources(text);
      } catch (err: any) {
        showToast("导入规则文件失败: " + (err?.message || String(err)));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleUrlImport = async () => {
    const url = remoteUrlInput.trim();
    if (!url) {
      showToast("请输入有效的网络规则订阅 URL");
      return;
    }
    setIsLoadingSources(true);
    try {
      await importSourcesFromUrl(url);
      setRemoteUrlInput("");
      setShowRemoteInput(false);
    } catch (err: any) {
      showToast("远程订阅拉取失败: " + (err?.message || String(err)));
    } finally {
      setIsLoadingSources(false);
    }
  };

  const handleJsonTextImport = async () => {
    const text = jsonText.trim();
    if (!text) {
      showToast("请粘贴 JSON 规则内容");
      return;
    }
    setIsLoadingSources(true);
    try {
      await importSources(text);
      setJsonText("");
      setShowJsonModal(false);
    } catch (err: any) {
      showToast("导入规则格式错误: " + (err?.message || String(err)));
    } finally {
      setIsLoadingSources(false);
    }
  };

  const handleExportConfig = () => {
    const dataStr =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(sourcesConfig, null, 2));
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", "vexa_sources.json");
    dlAnchor.click();
    showToast("已导出当前规则配置为 vexa_sources.json");
  };

  const currentTheme: ThemeMode = settings.themeMode || "system";

  const themeModes: {
    id: ThemeMode;
    title: string;
    desc: string;
    icon: React.ReactNode;
  }[] = [
    {
      id: "light",
      title: "浅色模式",
      desc: "明亮清爽的日间浅色外观",
      icon: <Sun className="w-4 h-4" />,
    },
    {
      id: "dark",
      title: "深色模式",
      desc: "沉浸护眼的暗黑影院外观",
      icon: <Moon className="w-4 h-4" />,
    },
    {
      id: "system",
      title: "跟随系统",
      desc: "随 macOS 系统深浅色自动切换",
      icon: <Monitor className="w-4 h-4" />,
    },
  ];

  const siteCount = sourcesConfig.sites?.length || 0;
  const vodCount = sourcesConfig.vodProviders?.length || 0;
  const parseCount = sourcesConfig.parseLines?.length || 0;
  const isConfigured = siteCount > 0 || vodCount > 0 || parseCount > 0;

  return (
    <div className="w-full p-3.5 sm:p-6 space-y-4 sm:space-y-5 h-full overflow-y-auto">
      <div>
        <h1 className="text-lg font-bold vx-title">软件设置与规则管理</h1>
        <p className="text-xs vx-muted mt-0.5">
          管理数据源与规则配置、界面外观主题、应用在线更新与下载保存位置
        </p>
      </div>

      {/* Hidden file input for importing JSON */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".json"
        className="hidden"
      />

      {/* Section 0: Sources & Rules Management (Core Shell-Source Separation) */}
      <div className="vx-card rounded-2xl p-5 border-sky-500/30 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-sky-500/20 shrink-0">
              <PackageOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold vx-title">
                  数据源与规则配置
                </h2>
                {isConfigured ? (
                  <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 text-[11px] font-semibold flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" />
                    已载入配置
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full bg-slate-500/15 border border-slate-500/30 text-slate-400 text-[11px] font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3 h-3" />
                    未配置
                  </span>
                )}
              </div>
              <p className="text-xs vx-muted mt-0.5">
                支持管理自定义网站导航、影视聚合源与解析专线。
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => fileInputRef.current?.click()}
              title="选择本地规则文件导入 (JSON)"
              className="px-3 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all active:scale-95"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>导入本地 JSON</span>
            </button>
            <button
              onClick={() => setShowRemoteInput(!showRemoteInput)}
              title="输入远程网络订阅规则 URL"
              className="px-3 py-1.5 rounded-xl vx-subtle hover:bg-sky-500/10 border text-xs font-medium vx-text flex items-center gap-1.5 transition-all active:scale-95"
            >
              <Link className="w-3.5 h-3.5 text-indigo-400" />
              <span>订阅链接</span>
            </button>
            <button
              onClick={() => setShowJsonModal(!showJsonModal)}
              title="直接粘贴 JSON 字符串导入规则"
              className="px-3 py-1.5 rounded-xl vx-subtle hover:bg-sky-500/10 border text-xs font-medium vx-text flex items-center gap-1.5 transition-all active:scale-95"
            >
              <FileCode className="w-3.5 h-3.5 text-amber-400" />
              <span>粘贴文本</span>
            </button>
            {isConfigured && (
              <>
                <button
                  onClick={handleExportConfig}
                  title="导出当前生效的全部规则为 JSON"
                  className="px-3 py-1.5 rounded-xl vx-subtle hover:bg-sky-500/10 border text-xs font-medium vx-text flex items-center gap-1.5 transition-all active:scale-95"
                >
                  <Download className="w-3.5 h-3.5 text-emerald-400" />
                  <span>导出规则</span>
                </button>
                <button
                  onClick={resetSources}
                  title="清空当前所有规则配置并恢复默认"
                  className="px-3 py-1.5 rounded-xl vx-subtle hover:bg-rose-500/10 hover:text-rose-400 border text-xs font-medium vx-muted flex items-center gap-1.5 transition-all active:scale-95"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>清空配置</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Remote URL Subscription Bar */}
        {showRemoteInput && (
          <div className="p-3 rounded-xl bg-sky-500/5 border border-sky-500/20 flex items-center gap-2">
            <input
              type="text"
              placeholder="请输入远程规则订阅地址 (例如: https://example.com/sources.json)"
              value={remoteUrlInput}
              onChange={(e) => setRemoteUrlInput(e.target.value)}
              className="flex-1 h-9 px-3 rounded-lg vx-input text-xs font-mono focus:outline-none focus:border-sky-500"
            />
            <button
              onClick={handleUrlImport}
              disabled={isLoadingSources}
              className="px-3.5 h-9 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold disabled:opacity-50 transition-all shrink-0"
            >
              {isLoadingSources ? "正在拉取..." : "确认拉取订阅"}
            </button>
          </div>
        )}

        {/* Paste JSON Modal Bar */}
        {showJsonModal && (
          <div className="p-3.5 rounded-xl bg-sky-500/5 border border-sky-500/20 space-y-2.5">
            <label className="text-xs font-medium vx-text flex items-center justify-between">
              <span>粘贴规则配置 JSON 内容：</span>
              <span className="text-[11px] vx-muted">支持标准 SourcesConfig 格式</span>
            </label>
            <textarea
              rows={5}
              placeholder='{"sites": [...], "vodProviders": [...], "parseLines": [...]}'
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="w-full p-2.5 rounded-lg vx-input text-xs font-mono focus:outline-none focus:border-sky-500 resize-none"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowJsonModal(false)}
                className="px-3 py-1.5 rounded-lg vx-subtle border text-xs vx-muted"
              >
                取消
              </button>
              <button
                onClick={handleJsonTextImport}
                disabled={isLoadingSources}
                className="px-3.5 py-1.5 rounded-lg bg-sky-500 hover:bg-sky-400 text-white text-xs font-semibold disabled:opacity-50"
              >
                {isLoadingSources ? "正在解析..." : "解析并导入"}
              </button>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 sm:gap-3">
          <div className="p-3 rounded-xl vx-subtle border flex items-center gap-3">
            <Globe className="w-4 h-4 text-sky-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] vx-muted">自定义导航站点</div>
              <div className="text-sm font-bold vx-title font-mono">
                {siteCount} <span className="text-xs font-normal">个站点</span>
              </div>
            </div>
          </div>
          <div className="p-3 rounded-xl vx-subtle border flex items-center gap-3">
            <Tv className="w-4 h-4 text-emerald-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] vx-muted">聚合影视采集源</div>
              <div className="text-sm font-bold vx-title font-mono">
                {vodCount} <span className="text-xs font-normal">个接口</span>
              </div>
            </div>
          </div>
          <div className="p-3 rounded-xl vx-subtle border flex items-center gap-3">
            <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
            <div className="min-w-0">
              <div className="text-[11px] vx-muted">网页解析专线</div>
              <div className="text-sm font-bold vx-title font-mono">
                {parseCount} <span className="text-xs font-normal">条通道</span>
              </div>
            </div>
          </div>
        </div>

        {/* Collapsible Rules Preview */}
        {isConfigured && (
          <div className="border-t pt-3">
            <button
              onClick={() => setShowRulesPreview(!showRulesPreview)}
              className="text-xs vx-muted hover:vx-title flex items-center gap-1 transition-colors"
            >
              <span>{showRulesPreview ? "收起规则明细" : "展开查看当前已生效的规则明细"}</span>
              {showRulesPreview ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>

            {showRulesPreview && (
              <div className="mt-3 space-y-3 text-xs">
                {siteCount > 0 && (
                  <div>
                    <div className="font-semibold vx-title mb-1.5">已配置网站：</div>
                    <div className="flex flex-wrap gap-1.5">
                      {sourcesConfig.sites.map((s) => (
                        <span
                          key={s.id}
                          className="px-2 py-0.5 rounded-md vx-subtle border text-[11px] vx-text flex items-center gap-1"
                        >
                          <span
                            className="w-1.5 h-1.5 rounded-full"
                            style={{ backgroundColor: s.color || "#38bdf8" }}
                          />
                          <span>{s.name}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {vodCount > 0 && (
                  <div>
                    <div className="font-semibold vx-title mb-1.5">已配置采集源：</div>
                    <div className="flex flex-wrap gap-1.5">
                      {sourcesConfig.vodProviders.map((v) => (
                        <span
                          key={v.id}
                          className="px-2 py-0.5 rounded-md vx-subtle border text-[11px] vx-text"
                        >
                          {v.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {parseCount > 0 && (
                  <div>
                    <div className="font-semibold vx-title mb-1.5">已配置解析线路：</div>
                    <div className="flex flex-wrap gap-1.5">
                      {sourcesConfig.parseLines.map((l) => (
                        <span
                          key={l.id}
                          className="px-2 py-0.5 rounded-md vx-subtle border text-[11px] vx-text"
                        >
                          {l.name}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Section 1: App Version & Online Hot-Update Card */}
      <div className="vx-card rounded-2xl p-5 border-sky-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-sky-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-sky-500/20 shrink-0">
            <Tv className="w-6 h-6 text-white" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <h2 className="text-base font-bold vx-title">Vexa 桌面客户端</h2>
              <span className="px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-500/30 text-sky-500 text-xs font-mono font-semibold">
                v1.0.0
              </span>
            </div>
            <p
              className={`text-xs ${
                updateState.downloaded
                  ? "text-emerald-500 font-semibold"
                  : updateState.error
                  ? "text-rose-500"
                  : "vx-text"
              }`}
            >
              {updateState.message ||
                "支持在线差量热更新，无需重新下载安装包即可一键升级软件"}
            </p>
          </div>
        </div>

        <button
          onClick={handleUpdateAction}
          disabled={updateState.checking}
          className={`px-4 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 shrink-0 transition-all shadow-sm ${
            updateState.downloaded
              ? "bg-emerald-500 hover:bg-emerald-400 text-slate-950"
              : "bg-sky-500 hover:bg-sky-400 disabled:opacity-50 text-white"
          }`}
        >
          {updateState.downloaded ? (
            <>
              <ArrowDownCircle className="w-4 h-4" />
              <span>立即安装并重启</span>
            </>
          ) : (
            <>
              <RefreshCw
                className={`w-4 h-4 ${
                  updateState.checking ? "animate-spin" : ""
                }`}
              />
              <span>
                {updateState.checking ? "正在检查更新..." : "检查软件更新"}
              </span>
            </>
          )}
        </button>
      </div>

      {/* Section 2: UI Appearance Theme Mode (Light / Dark / System) */}
      <div className="vx-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold vx-title">
          <Palette className="w-4 h-4 text-sky-500" />
          <span>界面外观模式（浅色 / 深色 / 跟随系统）</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {themeModes.map((mode) => {
            const active = currentTheme === mode.id;
            return (
              <button
                key={mode.id}
                onClick={() => updateSettings({ themeMode: mode.id })}
                className={`p-3.5 rounded-xl border text-left transition-all flex items-start gap-3 ${
                  active
                    ? "bg-sky-500/15 border-sky-500 shadow-sm"
                    : "vx-subtle hover:border-sky-500/40"
                }`}
              >
                <div
                  className={`p-2 rounded-lg shrink-0 ${
                    active ? "bg-sky-500 text-white" : "vx-card vx-muted"
                  }`}
                >
                  {mode.icon}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold vx-title">{mode.title}</div>
                  <div className="text-[11px] vx-muted mt-0.5 leading-snug">
                    {mode.desc}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Section 3: Playback & Quality Defaults */}
      <div className="vx-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold vx-title">
          <Sparkles className="w-4 h-4 text-sky-500" />
          <span>观影偏好设置</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-start">
          <div className="flex flex-col gap-2">
            <label className="h-5 flex items-center text-xs font-medium vx-text">
              打开视频时默认优先画质
            </label>
            <div className="relative">
              <select
                value={settings.preferredQuality}
                onChange={(e) =>
                  updateSettings({
                    preferredQuality: parseInt(e.target.value, 10),
                  })
                }
                className="w-full h-10 pl-3.5 pr-9 rounded-xl vx-input text-xs appearance-none focus:outline-none focus:border-sky-500 cursor-pointer"
              >
                <option value={480}>480P 标清 - 默认极速秒开</option>
                <option value={720}>720P 高清 - 省流流畅</option>
                <option value={1080}>1080P 超清 - 均衡清晰</option>
                <option value={2160}>4K 蓝光 (2160P) - 极清画质</option>
              </select>
              <ChevronDown className="w-4 h-4 vx-muted pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />
            </div>
          </div>
        </div>
      </div>

      {/* Section 4: Download Directory */}
      <div className="vx-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-bold vx-title">
          <Folder className="w-4 h-4 text-emerald-500" />
          <span>下载与保存位置</span>
        </div>

        <div className="flex flex-col gap-2">
          <label className="h-5 flex items-center text-xs font-medium vx-text">
            视频与音频默认保存文件夹（修改后自动保存）
          </label>
          <input
            type="text"
            value={settings.downloadDir}
            onChange={(e) => updateSettings({ downloadDir: e.target.value })}
            className="w-full h-10 px-3.5 rounded-xl vx-input text-xs font-mono focus:outline-none focus:border-sky-500"
          />
        </div>
      </div>
    </div>
  );
};
