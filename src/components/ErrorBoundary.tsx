import { Component, ErrorInfo, ReactNode } from "react";
import { AlertCircle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div className="space-y-1">
              <div className="text-sm font-bold vx-title">视图加载异常</div>
              <p className="text-xs vx-muted max-w-md">
                {this.state.error?.message || "播放器渲染遇到非预期状态，点击下方按钮重试"}
              </p>
            </div>
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 rounded-xl bg-sky-500 text-white text-xs font-semibold shadow-sm hover:bg-sky-400 active:scale-95 transition-all flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>重新加载视图</span>
            </button>
          </div>
        )
      );
    }

    return this.props.children;
  }
}
