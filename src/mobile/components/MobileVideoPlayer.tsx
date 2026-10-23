import React, {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
} from "react";
import Hls from "hls.js";
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Maximize,
  Minimize,
  Volume2,
  VolumeX,
  Volume1,
  Sun,
  Lock,
  Unlock,
  ArrowLeft,
  Check,
  Sparkles,
  SkipForward,
  Layers,
  X,
  Download,
} from "lucide-react";
import { VideoMetadata, VideoFormat } from "../../types/media";
import { useAppStore } from "../../store/useAppStore";
import { formatDuration } from "../../utils/format";
import { setAppFullscreen } from "../../services/api";

interface MobileVideoPlayerProps {
  video: VideoMetadata;
  format: VideoFormat | null;
  danmakuList?: any[];
  initialSeekTime?: number;
  onOpenDownloadModal?: () => void;
  onBack?: () => void;
}

function buildProxiedStreamUrl(
  rawUrl: string | undefined,
  headers: Record<string, string> | undefined,
  proxyPort: number | undefined,
  isHls?: boolean,
  mediaType: "video" | "audio" = "video"
): string {
  if (!rawUrl) return "";
  if (!proxyPort) return rawUrl;

  const hasCustomHeaders = headers && Object.keys(headers).length > 0;
  const isHttp = rawUrl.startsWith("http://") || rawUrl.startsWith("https://");
  const needsProxy =
    hasCustomHeaders || isHls || (isHttp && !rawUrl.includes("127.0.0.1"));

  if (!needsProxy) return rawUrl;

  const endpoint = isHls ? "m3u8" : "stream";
  const headerParam = encodeURIComponent(JSON.stringify(headers || {}));
  return `http://127.0.0.1:${proxyPort}/${endpoint}?url=${encodeURIComponent(
    rawUrl
  )}&headers=${headerParam}&media_type=${mediaType}`;
}

export const MobileVideoPlayer: React.FC<MobileVideoPlayerProps> = ({
  video,
  format,
  initialSeekTime = 0,
  onOpenDownloadModal,
  onBack,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastSavedTimeRef = useRef<number>(0);

  const {
    proxyPort,
    switchResolution,
    updateWatchProgress,
    switchEpisode,
    isMobileFullscreen,
    setIsMobileFullscreen,
  } = useAppStore();

  // Core Playback State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(video.duration || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isBuffering, setIsBuffering] = useState(false);
  const [brightness, setBrightness] = useState(1); // 0.3 - 1.5

  // Mobile Immersive Controls State
  const [showControls, setShowControls] = useState(true);
  const [isLocked, setIsLocked] = useState(false);
  const [activeDrawer, setActiveDrawer] = useState<
    "none" | "episodes" | "speed" | "quality"
  >("none");

  // Touch & Gesture Feedback
  const [touchSeekHUD, setTouchSeekHUD] = useState<{
    target: number;
    diff: number;
  } | null>(null);
  const [touchVolumeHUD, setTouchVolumeHUD] = useState<number | null>(null);
  const [touchBrightnessHUD, setTouchBrightnessHUD] = useState<number | null>(
    null
  );
  const [doubleTapAnim, setDoubleTapAnim] = useState<
    "left" | "right" | "center" | null
  >(null);

  // Auto-hide controls timer
  const controlsTimerRef = useRef<any>(null);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  const resetControlsTimer = useCallback(() => {
    if (controlsTimerRef.current) {
      clearTimeout(controlsTimerRef.current);
    }
    if (isPlayingRef.current && !isLocked && activeDrawer === "none") {
      controlsTimerRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3500);
    }
  }, [isLocked, activeDrawer]);

  useEffect(() => {
    if (isPlaying) {
      resetControlsTimer();
    } else {
      setShowControls(true);
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    }
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [isPlaying, resetControlsTimer]);

  // Orientation & Physical Screen State
  const [isPortrait, setIsPortrait] = useState<boolean>(() =>
    typeof window !== "undefined"
      ? window.innerHeight > window.innerWidth
      : false
  );
  const [forceLandscape, setForceLandscape] = useState(false);

  useEffect(() => {
    const handleOrientation = () => {
      setIsPortrait(window.innerHeight > window.innerWidth);
    };
    window.addEventListener("resize", handleOrientation);
    window.addEventListener("orientationchange", handleOrientation);
    return () => {
      window.removeEventListener("resize", handleOrientation);
      window.removeEventListener("orientationchange", handleOrientation);
    };
  }, []);

  const isRotated = false;

  const playerStyle: React.CSSProperties = useMemo(() => {
    if (isMobileFullscreen) {
      return {
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: 99999,
        backgroundColor: "#000000",
      };
    }
    return {};
  }, [isMobileFullscreen]);

  const currentEpIndex = video.currentEpisodeIndex || 1;
  const nextEpisode = video.episodes?.find(
    (ep) => ep.index === currentEpIndex + 1
  );

  // Proxied Video / Audio URLs
  const proxiedVideoUrl = useMemo(
    () =>
      buildProxiedStreamUrl(
        format?.videoUrl,
        format?.headers,
        proxyPort,
        format?.isHls,
        "video"
      ),
    [format, proxyPort]
  );

  const proxiedAudioUrl = useMemo(
    () =>
      format?.isDash && format?.audioUrl
        ? buildProxiedStreamUrl(
            format.audioUrl,
            format.headers,
            proxyPort,
            false,
            "audio"
          )
        : "",
    [format, proxyPort]
  );

  // Stream Loader (HLS & Progressive MP4 & DASH)
  useEffect(() => {
    const vEl = videoRef.current;
    const aEl = audioRef.current;
    if (!vEl || !proxiedVideoUrl) return;

    const targetSeek = initialSeekTime > 0 ? initialSeekTime : 0;
    let hls: Hls | null = null;

    setIsBuffering(true);
    setCurrentTime(targetSeek);
    setDuration(video.duration || 0);

    if (format?.isHls && Hls.isSupported()) {
      vEl.muted = isMuted;
      vEl.volume = isMuted ? 0 : volume;
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });
      hls.loadSource(proxiedVideoUrl);
      hls.attachMedia(vEl);
      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (targetSeek > 0) {
          vEl.currentTime = targetSeek;
        }
        setIsBuffering(false);
      });
      hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
        if (
          data.details?.totalduration &&
          isFinite(data.details.totalduration)
        ) {
          setDuration(data.details.totalduration);
        }
      });
      hls.on(Hls.Events.ERROR, () => {
        setIsBuffering(false);
      });
    } else {
      vEl.pause();
      if (proxiedAudioUrl && aEl) {
        vEl.muted = true;
        vEl.volume = 0;
        aEl.src = proxiedAudioUrl;
        aEl.muted = isMuted;
        aEl.volume = isMuted ? 0 : volume;
        aEl.playbackRate = playbackRate;
        aEl.load();
      } else {
        vEl.muted = isMuted;
        vEl.volume = isMuted ? 0 : volume;
        if (aEl) {
          aEl.pause();
          aEl.removeAttribute("src");
          aEl.load();
        }
      }

      vEl.src = proxiedVideoUrl;
      vEl.playbackRate = playbackRate;
      vEl.load();

      const onLoadedMeta = () => {
        setDuration(vEl.duration || video.duration || 0);
        if (targetSeek > 0 && targetSeek < (vEl.duration || 999999)) {
          vEl.currentTime = targetSeek;
          if (proxiedAudioUrl && aEl) {
            aEl.currentTime = targetSeek;
          }
        }
        setIsBuffering(false);
      };

      const onError = () => {
        setIsBuffering(false);
        if (format?.isDash) {
          const fallbackMp4 = video.formats?.find((f) => !f.isDash);
          if (fallbackMp4 && fallbackMp4.formatId !== format.formatId) {
            switchResolution(fallbackMp4, vEl.currentTime || 0);
          }
        }
      };

      vEl.addEventListener("loadedmetadata", onLoadedMeta, { once: true });
      vEl.addEventListener("error", onError, { once: true });

      return () => {
        vEl.removeEventListener("loadedmetadata", onLoadedMeta);
        vEl.removeEventListener("error", onError);
      };
    }

    return () => {
      if (hls) hls.destroy();
      if (vEl) {
        vEl.pause();
        vEl.removeAttribute("src");
        vEl.load();
      }
      if (aEl) {
        aEl.pause();
        aEl.removeAttribute("src");
        aEl.load();
      }
    };
  }, [video.id, video.url, proxiedVideoUrl, proxiedAudioUrl]);

  // Sync DASH separate audio
  useEffect(() => {
    const vEl = videoRef.current;
    const aEl = audioRef.current;
    if (!vEl || !aEl || !proxiedAudioUrl) return;

    const syncPlay = () => {
      if (Math.abs(vEl.currentTime - aEl.currentTime) > 0.2) {
        aEl.currentTime = vEl.currentTime;
      }
      aEl.play().catch(() => {});
    };
    const syncPause = () => aEl.pause();
    const syncSeek = () => {
      aEl.currentTime = vEl.currentTime;
    };
    const syncWaiting = () => aEl.pause();
    const syncPlaying = () => {
      aEl.currentTime = vEl.currentTime;
      aEl.play().catch(() => {});
    };

    vEl.addEventListener("play", syncPlay);
    vEl.addEventListener("pause", syncPause);
    vEl.addEventListener("seeking", syncSeek);
    vEl.addEventListener("seeked", syncSeek);
    vEl.addEventListener("waiting", syncWaiting);
    vEl.addEventListener("playing", syncPlaying);

    return () => {
      vEl.removeEventListener("play", syncPlay);
      vEl.removeEventListener("pause", syncPause);
      vEl.removeEventListener("seeking", syncSeek);
      vEl.removeEventListener("seeked", syncSeek);
      vEl.removeEventListener("waiting", syncWaiting);
      vEl.removeEventListener("playing", syncPlaying);
    };
  }, [proxiedAudioUrl]);

  // TimeUpdate & Watch Progress Saving
  const handleTimeUpdate = () => {
    const vEl = videoRef.current;
    const aEl = audioRef.current;
    if (!vEl) return;

    const now = vEl.currentTime;
    setCurrentTime(now);
    if (vEl.duration && isFinite(vEl.duration)) {
      setDuration(vEl.duration);
    }

    if (proxiedAudioUrl && aEl && !vEl.paused && !aEl.paused) {
      if (Math.abs(vEl.currentTime - aEl.currentTime) > 0.3) {
        aEl.currentTime = vEl.currentTime;
      }
    }

    if (Math.abs(now - lastSavedTimeRef.current) >= 5) {
      lastSavedTimeRef.current = now;
      updateWatchProgress(now, vEl.duration || duration);
    }
  };

  const togglePlay = () => {
    if (isLocked) return;
    const vEl = videoRef.current;
    if (!vEl) return;
    if (vEl.paused) {
      vEl.play().catch(() => {});
    } else {
      vEl.pause();
    }
  };

  const seekRelative = (deltaSeconds: number) => {
    const vEl = videoRef.current;
    const aEl = audioRef.current;
    if (!vEl) return;
    const nextTime = Math.max(0, Math.min(duration, vEl.currentTime + deltaSeconds));
    vEl.currentTime = nextTime;
    if (proxiedAudioUrl && aEl) aEl.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const handleSeekBarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const vEl = videoRef.current;
    const aEl = audioRef.current;
    setCurrentTime(val);
    if (vEl) vEl.currentTime = val;
    if (proxiedAudioUrl && aEl) aEl.currentTime = val;
    resetControlsTimer();
  };

  const changeSpeed = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
    if (audioRef.current) audioRef.current.playbackRate = rate;
    setActiveDrawer("none");
    resetControlsTimer();
  };

  const handleSelectFormat = (fmt: VideoFormat) => {
    const pos = videoRef.current?.currentTime || currentTime || 0;
    switchResolution(fmt, pos);
    setActiveDrawer("none");
    resetControlsTimer();
  };

  // Fullscreen & Immersive Mode Management
  const toggleFullscreen = async () => {
    if (!isMobileFullscreen) {
      setIsMobileFullscreen(true);
      setShowControls(true);
      resetControlsTimer();
      await setAppFullscreen(true);
      try {
        await (window.screen.orientation as any)?.lock?.("landscape").catch(() => {});
      } catch {}
    } else {
      setIsMobileFullscreen(false);
      setForceLandscape(false);
      setIsLocked(false);
      setActiveDrawer("none");
      await setAppFullscreen(false);
      try {
        (window.screen.orientation as any)?.unlock?.();
      } catch {}
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      if (!document.fullscreenElement && isMobileFullscreen) {
        setIsMobileFullscreen(false);
        setForceLandscape(false);
        setIsLocked(false);
        setActiveDrawer("none");
        setAppFullscreen(false).catch(() => {});
      }
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    document.addEventListener("webkitfullscreenchange", handleFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
      document.removeEventListener("webkitfullscreenchange", handleFsChange);
    };
  }, [isMobileFullscreen, setIsMobileFullscreen]);

  // Touch Gesture Engine (Tap, Double Tap, Drag)
  const touchStateRef = useRef<{
    startX: number;
    startY: number;
    startTime: number;
    mode: "none" | "seek" | "volume" | "brightness";
    initialTime: number;
    initialVolume: number;
    initialBrightness: number;
  }>({
    startX: 0,
    startY: 0,
    startTime: 0,
    mode: "none",
    initialTime: 0,
    initialVolume: 1,
    initialBrightness: 1,
  });

  const lastTapRef = useRef<{ time: number; x: number; y: number }>({
    time: 0,
    x: 0,
    y: 0,
  });
  const singleTapTimerRef = useRef<any>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const vEl = videoRef.current;

    touchStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now(),
      mode: "none",
      initialTime: vEl?.currentTime || currentTime || 0,
      initialVolume: volume,
      initialBrightness: brightness,
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isLocked) return;
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    const s = touchStateRef.current;
    const dx = touch.clientX - s.startX;
    const dy = touch.clientY - s.startY;

    const effectiveDx = isRotated ? dy : dx;
    const effectiveDy = isRotated ? -dx : dy;
    const effectiveStartX = isRotated ? s.startY : s.startX;
    const effectiveTotalWidth = isRotated
      ? window.innerHeight || 640
      : window.innerWidth || 360;

    const absEffectiveX = Math.abs(effectiveDx);
    const absEffectiveY = Math.abs(effectiveDy);

    // Identify gesture type once 14px threshold passed
    if (s.mode === "none") {
      if (absEffectiveX > 14 && absEffectiveX > absEffectiveY) {
        s.mode = "seek";
      } else if (absEffectiveY > 14 && absEffectiveY > absEffectiveX) {
        const isLeftHalf = effectiveStartX < effectiveTotalWidth * 0.5;
        s.mode = isLeftHalf ? "brightness" : "volume";
      }
    }

    if (s.mode === "seek") {
      // Horizontal scrub across effective width: max ±90s across screen width
      const ratio = effectiveDx / effectiveTotalWidth;
      const scrubRange = Math.min(180, Math.max(60, duration * 0.3));
      const deltaSec = ratio * scrubRange;
      const targetTime = Math.max(0, Math.min(duration, s.initialTime + deltaSec));
      setTouchSeekHUD({ target: targetTime, diff: deltaSec });
      resetControlsTimer();
    } else if (s.mode === "volume") {
      // Volume adjust
      const delta = -effectiveDy / 200;
      const newVol = Math.max(0, Math.min(1, s.initialVolume + delta));
      setVolume(newVol);
      setIsMuted(newVol === 0);
      if (videoRef.current) {
        videoRef.current.volume = proxiedAudioUrl ? 0 : newVol;
        videoRef.current.muted = proxiedAudioUrl ? true : newVol === 0;
      }
      if (audioRef.current && proxiedAudioUrl) {
        audioRef.current.volume = newVol;
        audioRef.current.muted = newVol === 0;
      }
      setTouchVolumeHUD(Math.round(newVol * 100));
      resetControlsTimer();
    } else if (s.mode === "brightness") {
      // Brightness adjust
      const delta = -effectiveDy / 250;
      const newBright = Math.max(0.35, Math.min(1.4, s.initialBrightness + delta));
      setBrightness(newBright);
      setTouchBrightnessHUD(Math.round(newBright * 100));
      resetControlsTimer();
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    const s = touchStateRef.current;
    const now = Date.now();
    const durationMs = now - s.startTime;
    const endTouch = e.changedTouches[0];
    const dx = endTouch.clientX - s.startX;
    const dy = endTouch.clientY - s.startY;
    const moved = Math.sqrt(dx * dx + dy * dy);

    // Apply seek if in scrub mode
    if (s.mode === "seek" && touchSeekHUD) {
      const vEl = videoRef.current;
      const aEl = audioRef.current;
      if (vEl) vEl.currentTime = touchSeekHUD.target;
      if (proxiedAudioUrl && aEl) aEl.currentTime = touchSeekHUD.target;
      setCurrentTime(touchSeekHUD.target);
      setTouchSeekHUD(null);
      s.mode = "none";
      return;
    }

    setTouchSeekHUD(null);
    setTouchVolumeHUD(null);
    setTouchBrightnessHUD(null);

    // Handle Tap & Double Tap
    if (moved < 12 && durationMs < 280) {
      const lastTap = lastTapRef.current;
      const tapPos = isRotated ? endTouch.clientY : endTouch.clientX;
      const lastTapPos = isRotated ? lastTap.y : lastTap.x;
      const isDouble =
        now - lastTap.time < 280 &&
        Math.abs(tapPos - lastTapPos) < 40;

      if (isDouble) {
        // Cancel single tap action
        if (singleTapTimerRef.current) {
          clearTimeout(singleTapTimerRef.current);
          singleTapTimerRef.current = null;
        }
        lastTapRef.current = { time: 0, x: 0, y: 0 };

        if (isLocked) return;

        const effectiveTotalWidth = isRotated
          ? window.innerHeight || 640
          : window.innerWidth || 360;

        if (tapPos < effectiveTotalWidth * 0.35) {
          // Double Tap Left: Rewind 10s
          seekRelative(-10);
          setDoubleTapAnim("left");
          setTimeout(() => setDoubleTapAnim(null), 650);
        } else if (tapPos > effectiveTotalWidth * 0.65) {
          // Double Tap Right: Fast Forward 10s
          seekRelative(10);
          setDoubleTapAnim("right");
          setTimeout(() => setDoubleTapAnim(null), 650);
        } else {
          // Double Tap Center: Toggle Play/Pause
          togglePlay();
          setDoubleTapAnim("center");
          setTimeout(() => setDoubleTapAnim(null), 500);
        }
      } else {
        lastTapRef.current = { time: now, x: endTouch.clientX, y: endTouch.clientY };
        singleTapTimerRef.current = setTimeout(() => {
          // Single tap: toggle controls
          setShowControls((prev) => !prev);
          if (!showControls) {
            resetControlsTimer();
          }
        }, 280);
      }
    }

    s.mode = "none";
  };

  const qualityShortLabel = useMemo(() => {
    const lbl = format?.qualityLabel || "高清";
    if (lbl.includes("4K") || lbl.includes("4k")) return "4K";
    if (lbl.includes("1080P") || lbl.includes("1080p")) return "1080P";
    if (lbl.includes("720P") || lbl.includes("720p")) return "720P";
    if (lbl.includes("480P") || lbl.includes("480p")) return "480P";
    return lbl.slice(0, 4);
  }, [format]);

  return (
    <div
      ref={containerRef}
      style={playerStyle}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      className={`relative w-full h-full bg-black select-none overflow-hidden flex items-center justify-center ${
        isMobileFullscreen ? "fixed inset-0 z-[99999]" : ""
      }`}
    >
      {/* Hidden Master Media Elements */}
      <video
        ref={videoRef}
        playsInline
        webkit-playsinline="true"
        x5-video-player-type="h5-page"
        style={{ filter: `brightness(${brightness})` }}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onEnded={() => {
          if (nextEpisode) switchEpisode(nextEpisode);
        }}
        className="w-full h-full object-contain pointer-events-none"
      />
      <audio ref={audioRef} className="hidden" preload="auto" />

      {/* Double Tap Animation Overlay */}
      {doubleTapAnim === "left" && (
        <div className="absolute left-8 inset-y-0 flex items-center justify-center pointer-events-none z-30 animate-scale-up">
          <div className="flex flex-col items-center gap-1 px-4 py-3 rounded-2xl bg-black/75 backdrop-blur-md border border-white/20 text-white shadow-2xl">
            <RotateCcw className="w-6 h-6 text-sky-400 animate-spin" />
            <span className="text-xs font-bold font-mono tracking-wider">-10 秒</span>
          </div>
        </div>
      )}
      {doubleTapAnim === "right" && (
        <div className="absolute right-8 inset-y-0 flex items-center justify-center pointer-events-none z-30 animate-scale-up">
          <div className="flex flex-col items-center gap-1 px-4 py-3 rounded-2xl bg-black/75 backdrop-blur-md border border-white/20 text-white shadow-2xl">
            <RotateCw className="w-6 h-6 text-sky-400 animate-spin" />
            <span className="text-xs font-bold font-mono tracking-wider">+10 秒</span>
          </div>
        </div>
      )}
      {doubleTapAnim === "center" && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-30 animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-black/80 backdrop-blur-md border border-white/20 text-white flex items-center justify-center shadow-2xl">
            {isPlaying ? (
              <Play className="w-8 h-8 fill-current text-white ml-1" />
            ) : (
              <Pause className="w-8 h-8 fill-current text-white" />
            )}
          </div>
        </div>
      )}

      {/* Scrub Time HUD Overlay */}
      {touchSeekHUD && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-40">
          <div className="px-5 py-3 rounded-2xl bg-black/85 backdrop-blur-xl border border-white/20 text-white flex flex-col items-center gap-1.5 shadow-2xl">
            <div className="text-sm font-bold font-mono text-sky-400">
              {formatDuration(touchSeekHUD.target)}
            </div>
            <div className="text-[11px] text-slate-300 font-mono">
              [ {formatDuration(touchSeekHUD.target)} / {formatDuration(duration)} ]
            </div>
            <div className="text-[10px] text-slate-400 font-mono">
              {touchSeekHUD.diff >= 0 ? "+" : ""}
              {Math.round(touchSeekHUD.diff)}s
            </div>
          </div>
        </div>
      )}

      {/* Volume HUD Overlay */}
      {touchVolumeHUD !== null && (
        <div className="absolute top-1/2 right-6 -translate-y-1/2 flex items-center pointer-events-none z-40">
          <div className="px-3.5 py-4 rounded-2xl bg-black/80 backdrop-blur-xl border border-white/20 text-white flex flex-col items-center gap-2 shadow-2xl">
            {touchVolumeHUD === 0 ? (
              <VolumeX className="w-5 h-5 text-rose-400" />
            ) : touchVolumeHUD < 50 ? (
              <Volume1 className="w-5 h-5 text-sky-400" />
            ) : (
              <Volume2 className="w-5 h-5 text-sky-400" />
            )}
            <div className="w-1.5 h-20 bg-white/20 rounded-full overflow-hidden flex flex-col justify-end">
              <div
                style={{ height: `${touchVolumeHUD}%` }}
                className="w-full bg-sky-400 rounded-full"
              />
            </div>
            <span className="text-[10px] font-mono font-bold">{touchVolumeHUD}%</span>
          </div>
        </div>
      )}

      {/* Brightness HUD Overlay */}
      {touchBrightnessHUD !== null && (
        <div className="absolute top-1/2 left-6 -translate-y-1/2 flex items-center pointer-events-none z-40">
          <div className="px-3.5 py-4 rounded-2xl bg-black/80 backdrop-blur-xl border border-white/20 text-white flex flex-col items-center gap-2 shadow-2xl">
            <Sun className="w-5 h-5 text-amber-400" />
            <div className="w-1.5 h-20 bg-white/20 rounded-full overflow-hidden flex flex-col justify-end">
              <div
                style={{ height: `${Math.min(100, Math.max(0, touchBrightnessHUD))}%` }}
                className="w-full bg-amber-400 rounded-full"
              />
            </div>
            <span className="text-[10px] font-mono font-bold">{touchBrightnessHUD}%</span>
          </div>
        </div>
      )}

      {/* Buffering Indicator */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none z-20">
          <div className="px-4 py-2 rounded-xl bg-black/80 backdrop-blur-md border border-white/10 text-xs text-white flex items-center gap-2 shadow-xl">
            <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <span>缓冲中...</span>
          </div>
        </div>
      )}

      {/* Center Big Play Button (when paused) */}
      {!isPlaying && !isBuffering && !isLocked && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            togglePlay();
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/35 z-20 cursor-pointer backdrop-blur-[1px]"
        >
          <button
            type="button"
            className="w-14 h-14 rounded-full bg-sky-500 active:bg-sky-600 text-white flex items-center justify-center shadow-2xl border-2 border-white/60 active:scale-90 transition-transform shadow-sky-500/40"
          >
            <Play className="w-6 h-6 ml-0.5 fill-current text-white" />
          </button>
        </div>
      )}

      {/* Floating Screen Lock Indicator & Toggle (Left Side) */}
      <div
        style={{
          left: "max(env(safe-area-inset-left, 0px), 16px)",
          top: "50%",
          transform: "translateY(-50%)",
        }}
        className={`absolute z-40 transition-opacity duration-300 ${
          showControls || isLocked ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            setIsLocked(!isLocked);
            resetControlsTimer();
          }}
          className={`w-9 h-9 rounded-full flex items-center justify-center backdrop-blur-xl border shadow-xl active:scale-90 transition-all ${
            isLocked
              ? "bg-amber-500 text-white border-amber-300"
              : "bg-black/75 text-white/90 border-white/20 hover:text-white"
          }`}
          title={isLocked ? "解锁屏幕" : "锁定屏幕"}
        >
          {isLocked ? <Lock className="w-4 h-4" /> : <Unlock className="w-4 h-4" />}
        </button>
      </div>

      {/* Top Floating Control Bar (Fade In / Out) */}
      <div
        style={{
          top: 0,
          left: 0,
          right: 0,
          paddingTop: "max(env(safe-area-inset-top, 0px), 8px)",
          paddingLeft: "max(env(safe-area-inset-left, 0px), 12px)",
          paddingRight: "max(env(safe-area-inset-right, 0px), 12px)",
        }}
        onTouchStart={(e) => e.stopPropagation()}
        className={`absolute z-30 bg-gradient-to-b from-black/90 via-black/50 to-transparent pb-4 px-2 flex items-center justify-between gap-2 transition-all duration-300 ${
          showControls && !isLocked
            ? "opacity-100 translate-y-0"
            : "opacity-0 -translate-y-3 pointer-events-none"
        }`}
      >
        {/* Back / Exit Fullscreen Button */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <button
            onClick={() => {
              if (isMobileFullscreen) {
                toggleFullscreen();
              } else if (onBack) {
                onBack();
              }
            }}
            className="p-1.5 rounded-full bg-white/10 active:bg-white/20 text-white shrink-0 active:scale-95 transition-transform"
            title="返回"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-bold text-white truncate drop-shadow-md">
            {video.title}
          </span>
          {video.currentEpisodeIndex && video.episodes && video.episodes.length > 1 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-md bg-sky-500/20 text-sky-300 font-semibold shrink-0">
              第 {video.currentEpisodeIndex} 集
            </span>
          )}
        </div>

        {/* Top Right Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Quality Pill */}
          <button
            onClick={() => {
              setActiveDrawer("quality");
              setShowControls(true);
            }}
            className="px-2 py-1 rounded-full bg-white/15 active:bg-white/25 border border-white/20 text-white text-[11px] font-semibold flex items-center gap-1 active:scale-95 transition-all"
          >
            <Sparkles className="w-3 h-3 text-sky-400" />
            <span>{qualityShortLabel}</span>
          </button>

          {/* Speed Pill */}
          <button
            onClick={() => {
              setActiveDrawer("speed");
              setShowControls(true);
            }}
            className="px-2 py-1 rounded-full bg-white/15 active:bg-white/25 border border-white/20 text-white text-[11px] font-semibold active:scale-95 transition-all"
          >
            <span>{playbackRate === 1 ? "倍速" : `${playbackRate}x`}</span>
          </button>

          {/* Quick Landscape / Portrait Toggle Button (in fullscreen when phone is held vertically) */}
          {isMobileFullscreen && isPortrait && (
            <button
              onClick={() => {
                setForceLandscape((prev) => !prev);
                resetControlsTimer();
              }}
              className="px-2.5 py-1 rounded-full bg-white/15 active:bg-white/25 border border-white/20 text-white text-[11px] font-semibold flex items-center gap-1 active:scale-95 transition-all"
              title={forceLandscape ? "切换为竖屏全屏" : "切换为横屏全屏"}
            >
              <RotateCw className="w-3 h-3 text-sky-400" />
              <span>{forceLandscape ? "竖屏" : "横屏"}</span>
            </button>
          )}

          {/* Download Button */}
          {onOpenDownloadModal && (
            <button
              onClick={onOpenDownloadModal}
              className="p-1.5 rounded-full bg-white/15 active:bg-white/25 border border-white/20 text-white shrink-0 active:scale-95 transition-all"
              title="下载视频"
            >
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Bottom Floating Control Bar (Fade In / Out) */}
      <div
        style={{
          bottom: 0,
          left: 0,
          right: 0,
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 8px)",
          paddingLeft: "max(env(safe-area-inset-left, 0px), 12px)",
          paddingRight: "max(env(safe-area-inset-right, 0px), 12px)",
        }}
        onTouchStart={(e) => e.stopPropagation()}
        className={`absolute z-30 bg-gradient-to-t from-black/95 via-black/60 to-transparent pt-6 px-3 flex flex-col gap-1.5 transition-all duration-300 ${
          showControls && !isLocked
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-3 pointer-events-none"
        }`}
      >
        {/* Progress Slider Row with Time Stamps */}
        <div className="flex items-center gap-2.5 w-full">
          <span className="text-[11px] font-mono text-slate-300 shrink-0 select-none">
            {formatDuration(currentTime)}
          </span>

          <div className="relative flex-1 flex items-center">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeekBarChange}
              className="w-full h-1.5 bg-white/25 rounded-full appearance-none cursor-pointer accent-sky-500 focus:outline-none"
            />
          </div>

          <span className="text-[11px] font-mono text-slate-400 shrink-0 select-none">
            {formatDuration(duration)}
          </span>
        </div>

        {/* Action Controls Row */}
        <div className="flex items-center justify-between pt-0.5">
          <div className="flex items-center gap-2">
            {/* Play/Pause Button */}
            <button
              onClick={togglePlay}
              className="p-1.5 rounded-full text-white hover:text-sky-400 active:scale-90 transition-transform"
              title={isPlaying ? "暂停" : "播放"}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </button>

            {/* Next Episode Button */}
            {nextEpisode && (
              <button
                onClick={() => switchEpisode(nextEpisode)}
                className="p-1.5 rounded-full text-white hover:text-sky-400 active:scale-90 transition-transform"
                title={`播放下集: ${nextEpisode.title || `第${nextEpisode.index}集`}`}
              >
                <SkipForward className="w-4 h-4" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Episode Drawer Button (if multi-episode series) */}
            {video.episodes && video.episodes.length > 1 && (
              <button
                onClick={() => {
                  setActiveDrawer("episodes");
                  setShowControls(true);
                }}
                className="px-2.5 py-1 rounded-full bg-white/10 active:bg-white/20 text-white text-xs font-semibold flex items-center gap-1 active:scale-95 transition-all"
              >
                <Layers className="w-3.5 h-3.5 text-sky-400" />
                <span>选集 ({video.episodes?.length || 0})</span>
              </button>
            )}

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              className="p-1.5 rounded-full bg-white/10 active:bg-white/20 text-white active:scale-90 transition-transform"
              title={isMobileFullscreen ? "退出全屏" : "全屏观看"}
            >
              {isMobileFullscreen ? (
                <Minimize className="w-4 h-4" />
              ) : (
                <Maximize className="w-4 h-4" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Episode Selection Bottom Sheet */}
      {activeDrawer === "episodes" && (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex flex-col justify-end animate-fade-in"
          onClick={() => setActiveDrawer("none")}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#121620]/95 backdrop-blur-2xl border-t border-white/15 rounded-t-3xl max-h-[70vh] flex flex-col p-4 shadow-2xl animate-slide-up"
          >
            <div className="flex items-center justify-between pb-3 border-b border-white/10">
              <span className="text-sm font-bold text-white flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-sky-400" />
                <span>选集 ({video.episodes?.length || 0})</span>
              </span>
              <button
                onClick={() => setActiveDrawer("none")}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="overflow-y-auto py-3 grid grid-cols-4 sm:grid-cols-6 gap-2">
              {video.episodes?.map((ep) => {
                const isCurrent = ep.index === currentEpIndex;
                return (
                  <button
                    key={ep.id || ep.index}
                    onClick={() => {
                      switchEpisode(ep);
                      setActiveDrawer("none");
                    }}
                    className={`py-2.5 rounded-xl text-xs font-semibold flex items-center justify-center transition-all ${
                      isCurrent
                        ? "bg-sky-500 text-white shadow-lg shadow-sky-500/30"
                        : "bg-white/5 text-slate-300 hover:bg-white/10 active:scale-95"
                    }`}
                  >
                    <span>{ep.title || `第${ep.index}集`}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Speed Bottom Sheet */}
      {activeDrawer === "speed" && (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex flex-col justify-end animate-fade-in"
          onClick={() => setActiveDrawer("none")}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#121620]/95 backdrop-blur-2xl border-t border-white/15 rounded-t-3xl p-4 shadow-2xl animate-slide-up space-y-2"
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <span className="text-sm font-bold text-white">倍速播放</span>
              <button
                onClick={() => setActiveDrawer("none")}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2 pt-1">
              {[0.75, 1.0, 1.25, 1.5, 2.0, 3.0].map((rate) => (
                <button
                  key={rate}
                  onClick={() => changeSpeed(rate)}
                  className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
                    playbackRate === rate
                      ? "bg-sky-500 text-white shadow-lg"
                      : "bg-white/5 text-slate-300 hover:bg-white/10 active:scale-95"
                  }`}
                >
                  {rate === 1.0 ? "1.0x 正常" : `${rate}x`}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Quality Bottom Sheet */}
      {activeDrawer === "quality" && (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm z-50 flex flex-col justify-end animate-fade-in"
          onClick={() => setActiveDrawer("none")}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#121620]/95 backdrop-blur-2xl border-t border-white/15 rounded-t-3xl p-4 shadow-2xl animate-slide-up space-y-2"
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <span className="text-sm font-bold text-white">选择播放画质</span>
              <button
                onClick={() => setActiveDrawer("none")}
                className="p-1 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-1.5 pt-1">
              {(video.formats || []).map((fmt) => {
                const isSelected = fmt.formatId === format?.formatId;
                return (
                  <button
                    key={fmt.formatId}
                    onClick={() => handleSelectFormat(fmt)}
                    className={`w-full px-3.5 py-2.5 rounded-xl text-xs flex items-center justify-between transition-all ${
                      isSelected
                        ? "bg-sky-500 text-white font-bold"
                        : "bg-white/5 text-slate-200 hover:bg-white/10 active:scale-95"
                    }`}
                  >
                    <div className="text-left">
                      <div>{fmt.qualityLabel}</div>
                      <div className="text-[10px] text-white/60">
                        {fmt.isDash ? "DASH 超清音画" : fmt.ext.toUpperCase()}
                      </div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
