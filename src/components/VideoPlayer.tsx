import React, { useEffect, useRef, useState, useMemo } from "react";
import Hls from "hls.js";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Sliders,
  Download,
  PictureInPicture2,
  Sparkles,
  Check,
  ArrowLeft,
  RotateCw,
  Lock,
  Unlock,
  List,
  SkipForward,
  X,
} from "lucide-react";
import {
  DanmakuItem,
  VideoFormat,
  VideoMetadata,
} from "../types/media";
import { useAppStore } from "../store/useAppStore";
import { formatDuration } from "../utils/format";
import { useIsMobile } from "../hooks/useIsMobile";

interface VideoPlayerProps {
  video: VideoMetadata;
  format: VideoFormat | null;
  danmakuList: DanmakuItem[];
  initialSeekTime?: number;
  onOpenDownloadModal: () => void;
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
    hasCustomHeaders ||
    isHls ||
    (isHttp && !rawUrl.includes("127.0.0.1"));

  if (!needsProxy) return rawUrl;

  const endpoint = isHls ? "m3u8" : "stream";
  const headerParam = encodeURIComponent(JSON.stringify(headers || {}));
  return `http://127.0.0.1:${proxyPort}/${endpoint}?url=${encodeURIComponent(
    rawUrl
  )}&headers=${headerParam}&media_type=${mediaType}`;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  video,
  format,
  danmakuList,
  initialSeekTime = 0,
  onOpenDownloadModal,
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const lastSavedTimeRef = useRef<number>(0);

  const {
    settings,
    updateSettings,
    proxyPort,
    switchResolution,
    updateWatchProgress,
    switchEpisode,
    setIsMobileFullscreen,
  } = useAppStore();

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(video.duration || 0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isBuffering, setIsBuffering] = useState(false);

  const isMobile = useIsMobile();
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showDanmakuPopover, setShowDanmakuPopover] = useState(false);
  const [zoomCrop, setZoomCrop] = useState(false);

  // Landscape & Mobile Fullscreen State
  const [orientationMode, setOrientationMode] = useState<"auto" | "landscape" | "portrait">("auto");
  const [isScreenLocked, setIsScreenLocked] = useState(false);
  const [showEpisodeDrawer, setShowEpisodeDrawer] = useState(false);

  const [isPortrait, setIsPortrait] = useState<boolean>(() =>
    typeof window !== "undefined" ? window.innerHeight > window.innerWidth : false
  );

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

  const shouldRotateLandscape =
    isFullscreen &&
    isMobile &&
    isPortrait &&
    (orientationMode === "landscape" || orientationMode === "auto");

  const toggleOrientation = () => {
    setOrientationMode((prev) => (prev === "landscape" ? "portrait" : "landscape"));
  };

  const currentEpIndex = video.currentEpisodeIndex || 1;
  const nextEpisode = video.episodes?.find((ep) => ep.index === currentEpIndex + 1);

  const handleNextEpisode = () => {
    if (nextEpisode) {
      switchEpisode(nextEpisode);
    }
  };

  const fullscreenStyle: React.CSSProperties = useMemo(() => {
    if (!isFullscreen) return {};
    if (shouldRotateLandscape) {
      return {
        position: "fixed",
        top: "50%",
        left: "50%",
        width: "100vh",
        height: "100vw",
        transform: "translate(-50%, -50%) rotate(90deg)",
        zIndex: 99999,
        maxWidth: "100vh",
        maxHeight: "100vw",
      };
    }
    return {
      position: "fixed",
      inset: 0,
      width: "100vw",
      height: "100vh",
      zIndex: 99999,
    };
  }, [isFullscreen, shouldRotateLandscape]);

  const shortQualityLabel = useMemo(() => {
    const lbl = format?.qualityLabel || "高清";
    if (lbl.includes("4K") || lbl.includes("4k")) return "4K";
    if (lbl.includes("1080P") || lbl.includes("1080p")) return "1080P";
    if (lbl.includes("720P") || lbl.includes("720p")) return "720P";
    if (lbl.includes("480P") || lbl.includes("480p")) return "480P";
    if (lbl.includes("超清")) return "超清";
    if (lbl.includes("高清")) return "高清";
    if (lbl.includes("标清")) return "标清";
    return lbl.slice(0, 5);
  }, [format]);

  // Mobile Touch Gestures State
  const touchStartRef = useRef<{
    x: number;
    y: number;
    initialTime: number;
  } | null>(null);
  const [touchSeek, setTouchSeek] = useState<{
    delta: number;
    target: number;
  } | null>(null);
  const lastTapRef = useRef<number>(0);

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

  // Load Video & Audio streams (handles HLS, DASH Dual-Track, and Progressive MP4)
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
        if (data.details?.totalduration && isFinite(data.details.totalduration)) {
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
        // Automatic fallback: if DASH stream fails to decode, switch to progressive MP4
        if (format?.isDash) {
          const fallbackMp4 = video.formats.find((f) => !f.isDash);
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
      if (hls) {
        hls.destroy();
      }
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

  // Synchronize separate DASH audio element with master video element
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

  // Handle TimeUpdate, SponsorBlock Auto-Skip & History Progress Saving
  const handleTimeUpdate = () => {
    const vEl = videoRef.current;
    const aEl = audioRef.current;
    if (!vEl) return;

    const now = vEl.currentTime;
    setCurrentTime(now);
    if (vEl.duration && isFinite(vEl.duration)) {
      setDuration(vEl.duration);
    }

    // Drift correction for DASH dual streams
    if (proxiedAudioUrl && aEl && !vEl.paused && !aEl.paused) {
      if (Math.abs(vEl.currentTime - aEl.currentTime) > 0.3) {
        aEl.currentTime = vEl.currentTime;
      }
    }

    // Save watch progress every 5 seconds
    if (Math.abs(now - lastSavedTimeRef.current) >= 5) {
      lastSavedTimeRef.current = now;
      updateWatchProgress(now, vEl.duration || duration);
    }
  };

  const togglePlay = () => {
    if (isScreenLocked) return;
    const vEl = videoRef.current;
    if (!vEl) return;
    if (vEl.paused) {
      vEl.play().catch(() => {});
    } else {
      vEl.pause();
    }
  };

  const handleVideoEnded = () => {
    if (nextEpisode) {
      switchEpisode(nextEpisode);
    }
  };

  const handleSeekBarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    const vEl = videoRef.current;
    const aEl = audioRef.current;
    setCurrentTime(val);
    if (vEl) {
      vEl.currentTime = val;
    }
    if (proxiedAudioUrl && aEl) {
      aEl.currentTime = val;
    }
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    setIsMuted(val === 0);
    if (videoRef.current) {
      videoRef.current.volume = proxiedAudioUrl ? 0 : val;
      videoRef.current.muted = proxiedAudioUrl ? true : val === 0;
    }
    if (audioRef.current && proxiedAudioUrl) {
      audioRef.current.volume = val;
      audioRef.current.muted = val === 0;
    }
  };

  const toggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    if (videoRef.current) {
      videoRef.current.muted = proxiedAudioUrl ? true : nextMuted;
    }
    if (audioRef.current && proxiedAudioUrl) {
      audioRef.current.muted = nextMuted;
    }
  };

  const changeSpeed = (rate: number) => {
    setPlaybackRate(rate);
    if (videoRef.current) videoRef.current.playbackRate = rate;
    if (audioRef.current) audioRef.current.playbackRate = rate;
    setShowSpeedMenu(false);
  };

  const handleSelectFormat = (fmt: VideoFormat) => {
    const pos = videoRef.current?.currentTime || currentTime || 0;
    switchResolution(fmt, pos);
    setShowQualityMenu(false);
  };

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!isFullscreen) {
      setIsFullscreen(true);
      setIsMobileFullscreen(true);
      setOrientationMode("auto");
      try {
        if (containerRef.current.requestFullscreen) {
          await containerRef.current.requestFullscreen();
        }
      } catch {}
      try {
        (window.screen.orientation as any)?.lock?.("landscape").catch(() => {});
      } catch {}
    } else {
      setIsFullscreen(false);
      setIsMobileFullscreen(false);
      setShowEpisodeDrawer(false);
      setIsScreenLocked(false);
      setOrientationMode("auto");
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        }
      } catch {}
      try {
        (window.screen.orientation as any)?.unlock?.();
      } catch {}
    }
  };

  useEffect(() => {
    const handleFsChange = () => {
      if (!document.fullscreenElement && isFullscreen) {
        setIsFullscreen(false);
        setIsMobileFullscreen(false);
      }
    };
    document.addEventListener("fullscreenchange", handleFsChange);
    document.addEventListener("webkitfullscreenchange", handleFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFsChange);
      document.removeEventListener("webkitfullscreenchange", handleFsChange);
    };
  }, [isFullscreen, setIsMobileFullscreen]);

  useEffect(() => {
    return () => {
      setIsMobileFullscreen(false);
      try {
        (window.screen.orientation as any)?.unlock?.();
      } catch {}
    };
  }, [setIsMobileFullscreen]);

  const togglePiP = async () => {
    const vEl = videoRef.current;
    if (!vEl) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await vEl.requestPictureInPicture();
      }
    } catch {}
  };

  // Desktop Keyboard Shortcuts (Space: Play/Pause, Left/Right: Seek ±5s, Up/Down: Volume ±10%, F: Fullscreen, M: Mute)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement as HTMLElement)?.tagName?.toLowerCase();
      if (
        activeTag === "input" ||
        activeTag === "textarea" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        const vEl = videoRef.current;
        if (vEl) {
          const target = Math.max(0, vEl.currentTime - 5);
          vEl.currentTime = target;
          setCurrentTime(target);
          if (audioRef.current && proxiedAudioUrl) {
            audioRef.current.currentTime = target;
          }
        }
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        const vEl = videoRef.current;
        if (vEl) {
          const maxDur = vEl.duration || duration || 999999;
          const target = Math.min(maxDur, vEl.currentTime + 5);
          vEl.currentTime = target;
          setCurrentTime(target);
          if (audioRef.current && proxiedAudioUrl) {
            audioRef.current.currentTime = target;
          }
        }
      } else if (e.code === "ArrowUp") {
        e.preventDefault();
        setVolume((prev) => {
          const next = Math.min(1, parseFloat((prev + 0.1).toFixed(2)));
          if (videoRef.current) {
            videoRef.current.volume = proxiedAudioUrl ? 0 : next;
            videoRef.current.muted = false;
          }
          if (audioRef.current && proxiedAudioUrl) {
            audioRef.current.volume = next;
            audioRef.current.muted = false;
          }
          setIsMuted(false);
          return next;
        });
      } else if (e.code === "ArrowDown") {
        e.preventDefault();
        setVolume((prev) => {
          const next = Math.max(0, parseFloat((prev - 0.1).toFixed(2)));
          if (videoRef.current) {
            videoRef.current.volume = proxiedAudioUrl ? 0 : next;
            videoRef.current.muted = next === 0;
          }
          if (audioRef.current && proxiedAudioUrl) {
            audioRef.current.volume = next;
            audioRef.current.muted = next === 0;
          }
          setIsMuted(next === 0);
          return next;
        });
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "m" || e.key === "M") {
        e.preventDefault();
        toggleMute();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [duration, proxiedAudioUrl, isMuted, volume]);

  // Compute active Danmaku within current window [currentTime - 6s, currentTime]
  const activeDanmakus = useMemo(() => {
    if (!settings.danmakuEnabled || !danmakuList.length) return [];
    return danmakuList.filter(
      (d) => currentTime >= d.time && currentTime <= d.time + 7.5
    );
  }, [currentTime, danmakuList, settings.danmakuEnabled]);

  const areaMaxTrack =
    settings.danmakuArea === "quarter"
      ? 3
      : settings.danmakuArea === "half"
      ? 6
      : 10;

  // Mobile Touch Gestures: Horizontal swipe to seek, double tap to play/pause
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isScreenLocked || e.touches.length !== 1) return;
    const touch = e.touches[0];
    touchStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      initialTime: videoRef.current?.currentTime || currentTime || 0,
    };
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isScreenLocked || !touchStartRef.current || e.touches.length !== 1) return;
    const touch = e.touches[0];
    const dx = touch.clientX - touchStartRef.current.x;
    const dy = touch.clientY - touchStartRef.current.y;

    if (Math.abs(dx) > 18 && Math.abs(dx) > Math.abs(dy)) {
      const width = containerRef.current?.clientWidth || 360;
      const deltaSec = Math.round((dx / width) * 90);
      const target = Math.max(
        0,
        Math.min(duration || 999999, touchStartRef.current.initialTime + deltaSec)
      );
      setTouchSeek({ delta: deltaSec, target });
    }
  };

  const handleTouchEnd = () => {
    if (isScreenLocked) return;
    if (touchSeek) {
      if (videoRef.current) {
        videoRef.current.currentTime = touchSeek.target;
        setCurrentTime(touchSeek.target);
        if (audioRef.current && proxiedAudioUrl) {
          audioRef.current.currentTime = touchSeek.target;
        }
      }
      setTouchSeek(null);
      touchStartRef.current = null;
      return;
    }

    const now = Date.now();
    if (now - lastTapRef.current < 280) {
      togglePlay();
      lastTapRef.current = 0;
    } else {
      lastTapRef.current = now;
    }
    touchStartRef.current = null;
  };

  return (
    <div
      ref={containerRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={fullscreenStyle}
      className={`video-player-canvas bg-black group select-none transition-all ${
        isFullscreen
          ? "rounded-none border-0 overflow-hidden flex items-center justify-center"
          : "relative w-full aspect-video rounded-2xl overflow-hidden border border-white/10 shadow-2xl"
      }`}
    >
      {/* Fullscreen Locked Indicator Button */}
      {isFullscreen && isScreenLocked && (
        <button
          onClick={() => setIsScreenLocked(false)}
          style={{
            top: "max(env(safe-area-inset-top, 0px), 16px)",
            left: "max(env(safe-area-inset-left, 0px), 16px)",
          }}
          className="absolute z-50 px-3.5 py-2 rounded-full bg-black/80 backdrop-blur-md border border-white/20 text-white text-xs font-semibold flex items-center gap-2 shadow-2xl active:scale-95 transition-all"
        >
          <Lock className="w-4 h-4 text-amber-400" />
          <span>点击解锁屏幕</span>
        </button>
      )}

      {/* Fullscreen Rich Top Navigation Bar */}
      {isFullscreen && !isScreenLocked && (
        <div
          style={{
            paddingTop: "max(env(safe-area-inset-top, 0px), 12px)",
            paddingLeft: "max(env(safe-area-inset-left, 0px), 16px)",
            paddingRight: "max(env(safe-area-inset-right, 0px), 16px)",
          }}
          className="absolute top-0 inset-x-0 z-30 flex items-center justify-between gap-2 px-3 py-2 bg-gradient-to-b from-black/85 via-black/45 to-transparent"
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={toggleFullscreen}
              className="px-2.5 py-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center gap-1 active:scale-95 transition-all"
              title="退出全屏"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold pr-0.5">退出</span>
            </button>

            <span className="text-xs font-bold text-white truncate max-w-[180px] sm:max-w-md drop-shadow-md">
              {video.title}
            </span>
            {video.currentEpisodeIndex && video.episodes && video.episodes.length > 1 && (
              <span className="text-[11px] text-sky-400 font-semibold shrink-0">
                第 {video.currentEpisodeIndex} 集
              </span>
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {isMobile && (
              <button
                onClick={toggleOrientation}
                className="px-2.5 py-1 rounded-full bg-white/10 hover:bg-white/20 text-white text-[11px] font-semibold flex items-center gap-1 active:scale-95 transition-all"
                title="切换横屏/竖屏"
              >
                <RotateCw className="w-3.5 h-3.5" />
                <span>{shouldRotateLandscape ? "竖屏" : "横屏"}</span>
              </button>
            )}

            <button
              onClick={() => setIsScreenLocked(true)}
              className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 text-white text-xs active:scale-95 transition-all"
              title="锁定屏幕"
            >
              <Unlock className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}
      {/* Master Video Element */}
      <video
        ref={videoRef}
        className={`w-full h-full object-contain cursor-pointer transition-transform duration-300 origin-top ${
          zoomCrop ? "scale-[1.08] -translate-y-[3%]" : ""
        }`}
        onClick={togglePlay}
        onDoubleClick={toggleFullscreen}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onLoadedData={() => setIsBuffering(false)}
        onPlaying={() => setIsBuffering(false)}
        onCanPlay={() => setIsBuffering(false)}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleVideoEnded}
        playsInline
      />

      {/* Slave Audio Element for 1080p/4K DASH separated streams */}
      <audio ref={audioRef} className="hidden" />

      {/* Scrolling & Fixed Danmaku Layer */}
      {settings.danmakuEnabled && activeDanmakus.length > 0 && (
        <div
          className="absolute inset-0 pointer-events-none overflow-hidden z-10"
          style={{ opacity: settings.danmakuOpacity }}
        >
          {activeDanmakus.map((dm, idx) => {
            const trackIndex = idx % areaMaxTrack;
            const topPercent = 4 + trackIndex * 8.5;
            const elapsed = Math.max(0, currentTime - dm.time);
            const progress = Math.min(1, elapsed / 7.5);

            if (dm.mode === 5 || dm.mode === 4) {
              // Top / Bottom centered danmaku
              return (
                <div
                  key={`${dm.time}-${dm.text}-${idx}`}
                  className="absolute left-1/2 -translate-x-1/2 font-bold whitespace-nowrap px-2 py-0.5 rounded"
                  style={{
                    top: `${topPercent}%`,
                    color: dm.color || "#ffffff",
                    fontSize: "20px",
                    textShadow:
                      "1px 1px 2px rgba(0,0,0,0.95), -1px -1px 2px rgba(0,0,0,0.95)",
                  }}
                >
                  {dm.text}
                </div>
              );
            }

            // Scrolling danmaku (right to left)
            const rightPos = -15 + progress * 130;
            return (
              <div
                key={`${dm.time}-${dm.text}-${idx}`}
                className="absolute font-bold whitespace-nowrap transition-none"
                style={{
                  top: `${topPercent}%`,
                  right: `${rightPos}%`,
                  color: dm.color || "#ffffff",
                  fontSize: "20px",
                  textShadow:
                    "1px 1px 2px rgba(0,0,0,0.95), -1px -1px 2px rgba(0,0,0,0.95)",
                }}
              >
                {dm.text}
              </div>
            );
          })}
        </div>
      )}

      {/* Top Overlay: Resolution & Ad-Free Status Badge */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between pointer-events-none z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <div className="flex items-center gap-2 bg-black/70 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-xs font-medium text-white">
            {format?.qualityLabel || "超清"} · 高速直连
          </span>
          {video.authUsed === "official_login" ? (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">
              已登录会话
            </span>
          ) : (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-300 border border-sky-500/30">
              标准流媒体
            </span>
          )}
        </div>
      </div>

      {/* SponsorBlock Auto-Skip Notification Toast inside Player */}
      {/* Buffering Indicator */}
      {isBuffering && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none z-20">
          <div className="px-4 py-2.5 rounded-xl bg-black/80 backdrop-blur-md border border-white/10 text-xs text-slate-200 flex items-center gap-2.5">
            <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin" />
            <span>正在加载 {format?.qualityLabel || "高清"} 媒体流...</span>
          </div>
        </div>
      )}

      {/* Mobile Touch Gesture HUD */}
      {touchSeek && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/40 z-30 pointer-events-none">
          <div className="px-5 py-3 rounded-2xl bg-black/85 backdrop-blur-md border border-white/20 text-white flex flex-col items-center gap-1 shadow-2xl">
            <span className="text-sm font-semibold flex items-center gap-1">
              <span>{touchSeek.delta > 0 ? "快进" : "快退"}</span>
              <span className="font-mono text-sky-400">
                {touchSeek.delta > 0 ? `+${touchSeek.delta}s` : `${touchSeek.delta}s`}
              </span>
            </span>
            <span className="text-xs font-mono text-slate-300">
              目标进度: {formatDuration(touchSeek.target)} / {formatDuration(duration)}
            </span>
          </div>
        </div>
      )}

      {/* Center Big Play Button Overlay when paused & ready */}
      {!isPlaying && !isBuffering && !isScreenLocked && (
        <div
          onClick={togglePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/40 z-20 cursor-pointer backdrop-blur-[1.5px] transition-all hover:bg-black/30 group/center"
        >
          <div className="flex flex-col items-center gap-2 sm:gap-3 transform transition-transform group-hover/center:scale-105">
            <button
              type="button"
              className={`${
                isMobile ? "w-14 h-14" : "w-20 h-20"
              } rounded-full bg-sky-500 hover:bg-sky-400 text-white flex items-center justify-center shadow-2xl border-2 border-white/50 transition-all duration-300 shadow-sky-500/40`}
              title="点击播放"
            >
              <Play
                className={`${
                  isMobile ? "w-6 h-6 ml-0.5" : "w-9 h-9 ml-1"
                } fill-current text-white drop-shadow-md`}
              />
            </button>
            {isMobile ? (
              <span className="text-[10px] font-medium text-white/90 bg-black/70 px-2.5 py-0.5 rounded-full border border-white/10 backdrop-blur-md">
                点击开始播放
              </span>
            ) : (
              <span className="text-xs font-semibold text-white tracking-wider bg-black/75 px-4 py-1.5 rounded-full border border-white/20 shadow-xl backdrop-blur-md">
                解析已就绪 · 点击开始播放
              </span>
            )}
          </div>
        </div>
      )}

      {/* Bottom Control Bar */}
      {!isScreenLocked && (
        <div
          onTouchStart={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          onTouchEnd={(e) => e.stopPropagation()}
          className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/75 to-transparent ${
            isMobile ? "pt-6 pb-2 px-2.5" : "pt-10 pb-2.5 sm:pb-3.5 px-2.5 sm:px-4"
          } z-20 opacity-95 group-hover:opacity-100 transition-opacity`}
        >
          {/* Progress Bar with SponsorBlock Highlight Markers */}
          <div className="relative w-full h-4 sm:h-5 flex items-center mb-1.5 sm:mb-2">
            {/* Background Track */}
            <div className="w-full h-1 sm:h-1.5 bg-white/20 rounded-full overflow-hidden relative">
              {/* Played Progress */}
              <div
                className="h-full bg-sky-500 rounded-full"
                style={{
                  width: `${
                    duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0
                  }%`,
                }}
              />
            </div>

            {/* Interactive Range Input */}
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={currentTime}
              onChange={handleSeekBarChange}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>

          {/* Main Controls Row */}
          <div className="flex items-center justify-between gap-1.5 sm:gap-2">
            {/* Left: Play/Pause, Next Episode, Volume, Time */}
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <button
                onClick={togglePlay}
                className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg bg-white/10 hover:bg-sky-500 text-white flex items-center justify-center transition-colors shrink-0"
                title={isPlaying ? "暂停" : "播放"}
              >
                {isPlaying ? (
                  <Pause className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
                ) : (
                  <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current ml-0.5" />
                )}
              </button>

              {/* Next Episode Button */}
              {nextEpisode && (
                <button
                  onClick={handleNextEpisode}
                  className="w-7 h-7 sm:w-9 sm:h-9 rounded-lg bg-white/10 hover:bg-sky-500 text-white flex items-center justify-center transition-colors shrink-0"
                  title={`下一集: ${nextEpisode.title || `第 ${nextEpisode.index} 集`}`}
                >
                  <SkipForward className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
                </button>
              )}

              {/* Volume Control */}
              <div className="hidden sm:flex items-center gap-1.5">
                <button
                  onClick={toggleMute}
                  className="p-1.5 text-slate-200 hover:text-white transition-colors"
                  title={isMuted ? "取消静音" : "静音"}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 text-rose-400" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 accent-sky-400 cursor-pointer h-1"
                />
              </div>

              {/* Time Display */}
              <div className="text-[10px] sm:text-xs font-mono text-slate-300 ml-0.5 sm:ml-1 whitespace-nowrap">
                <span className="text-white font-semibold">
                  {formatDuration(currentTime)}
                </span>
                <span className="mx-0.5 sm:mx-1 text-slate-500">/</span>
                <span>{formatDuration(duration)}</span>
              </div>
            </div>

            {/* Right: Episodes, Danmaku Switch, Resolution, Speed, Download, PiP, Fullscreen */}
            <div className="flex items-center gap-1.5 sm:gap-2 relative shrink-0">
              {/* Episode Selector Drawer Trigger */}
              {video.episodes && video.episodes.length > 1 && (
                <button
                  onClick={() => {
                    setShowEpisodeDrawer(!showEpisodeDrawer);
                    setShowQualityMenu(false);
                    setShowSpeedMenu(false);
                    setShowDanmakuPopover(false);
                  }}
                  className={`rounded-lg font-semibold flex items-center transition-colors ${
                    showEpisodeDrawer
                      ? "bg-sky-500 text-white shadow-sm"
                      : "bg-white/10 hover:bg-white/20 text-slate-200"
                  } ${
                    isMobile
                      ? "px-2 py-1 text-[11px] gap-1"
                      : "px-2.5 py-1.5 text-xs gap-1.5"
                  }`}
                  title="剧集选集"
                >
                  <List className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  <span>选集</span>
                </button>
              )}
            {/* Danmaku Toggle */}
            {isMobile ? (
              <button
                onClick={() =>
                  updateSettings({ danmakuEnabled: !settings.danmakuEnabled })
                }
                className={`px-2 py-1 rounded-md text-[11px] font-bold transition-colors ${
                  settings.danmakuEnabled
                    ? "bg-sky-500 text-white shadow-sm"
                    : "bg-white/10 text-slate-400 hover:text-slate-200"
                }`}
                title="开关弹幕"
              >
                弹
              </button>
            ) : (
              <div className="relative flex items-center bg-white/10 rounded-lg p-0.5 border border-white/10">
                <button
                  onClick={() =>
                    updateSettings({ danmakuEnabled: !settings.danmakuEnabled })
                  }
                  className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1 transition-colors ${
                    settings.danmakuEnabled
                      ? "bg-sky-500 text-white"
                      : "text-slate-400 hover:text-slate-200"
                  }`}
                  title="开关弹幕"
                >
                  <span>弹</span>
                  <span className="font-normal text-[11px]">
                    {settings.danmakuEnabled ? "已开" : "已关"}
                  </span>
                </button>
                <button
                  onClick={() => {
                    setShowDanmakuPopover(!showDanmakuPopover);
                    setShowQualityMenu(false);
                    setShowSpeedMenu(false);
                  }}
                  className="px-1.5 py-1 text-slate-300 hover:text-white"
                  title="弹幕显示设置"
                >
                  <Sliders className="w-3.5 h-3.5" />
                </button>

                {showDanmakuPopover && (
                  <div className="absolute bottom-11 right-0 w-64 bg-[#181c26]/95 backdrop-blur-xl border border-white/15 rounded-xl p-4 shadow-2xl z-40 text-xs space-y-3">
                    <div className="font-semibold text-white flex items-center justify-between">
                      <span>弹幕显示设置</span>
                      <button
                        onClick={() => setShowDanmakuPopover(false)}
                        className="text-slate-400 hover:text-white"
                      >
                        关闭
                      </button>
                    </div>
                    <div>
                      <div className="flex justify-between text-slate-300 mb-1">
                        <span>不透明度</span>
                        <span>{Math.round(settings.danmakuOpacity * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0.2}
                        max={1}
                        step={0.05}
                        value={settings.danmakuOpacity}
                        onChange={(e) =>
                          updateSettings({
                            danmakuOpacity: parseFloat(e.target.value),
                          })
                        }
                        className="w-full accent-sky-400"
                      />
                    </div>
                    <div>
                      <div className="text-slate-300 mb-1.5">显示区域</div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {(
                          [
                            { id: "quarter", label: "1/4 屏" },
                            { id: "half", label: "半屏" },
                            { id: "full", label: "满屏" },
                          ] as const
                        ).map((area) => (
                          <button
                            key={area.id}
                            onClick={() =>
                              updateSettings({ danmakuArea: area.id })
                            }
                            className={`py-1 rounded border text-center ${
                              settings.danmakuArea === area.id
                                ? "bg-sky-500/20 border-sky-500 text-sky-300 font-semibold"
                                : "border-white/10 text-slate-400 hover:text-white"
                            }`}
                          >
                            {area.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Resolution Switcher Button */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowQualityMenu(!showQualityMenu);
                  setShowSpeedMenu(false);
                  setShowDanmakuPopover(false);
                }}
                className={`rounded-lg bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-200 font-semibold flex items-center transition-colors ${
                  isMobile
                    ? "px-2 py-1 text-[11px] gap-1"
                    : "px-3 py-1.5 text-xs gap-1.5"
                }`}
              >
                <Sparkles className="w-3 h-3 text-sky-400 shrink-0" />
                <span>
                  {isMobile
                    ? shortQualityLabel
                    : `清晰度：${format?.qualityLabel || "480P 标清"}`}
                </span>
              </button>

              {showQualityMenu && (
                <div className="absolute bottom-11 right-0 w-52 sm:w-56 max-h-48 overflow-y-auto bg-[#181c26]/95 backdrop-blur-xl border border-white/15 rounded-xl p-1.5 shadow-2xl z-40 space-y-1">
                  <div className="px-2.5 py-1 text-[10px] sm:text-[11px] font-medium text-slate-400 border-b border-white/10">
                    切换分辨率（保持当前播放进度）
                  </div>
                  {video.formats.map((fmt) => {
                    const isSelected = fmt.formatId === format?.formatId;
                    return (
                      <button
                        key={fmt.formatId}
                        onClick={() => handleSelectFormat(fmt)}
                        className={`w-full px-2.5 py-1.5 sm:py-2 rounded-lg text-left text-xs flex items-center justify-between transition-colors ${
                          isSelected
                            ? "bg-sky-500 text-white font-semibold"
                            : "text-slate-200 hover:bg-white/10"
                        }`}
                      >
                        <div>
                          <div className="text-[11px] sm:text-xs">{fmt.qualityLabel}</div>
                          <div
                            className={`text-[9px] sm:text-[10px] ${
                              isSelected ? "text-sky-100" : "text-slate-400"
                            }`}
                          >
                            {fmt.isDash ? "DASH 超清音画同步" : fmt.ext.toUpperCase()}
                            {fmt.fps && fmt.fps >= 60 ? ` · ${fmt.fps}帧` : ""}
                          </div>
                        </div>
                        {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Playback Speed Switcher */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSpeedMenu(!showSpeedMenu);
                  setShowQualityMenu(false);
                  setShowDanmakuPopover(false);
                }}
                className={`rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 font-medium transition-colors ${
                  isMobile
                    ? "px-1.5 py-1 text-[11px]"
                    : "px-2.5 py-1.5 text-xs"
                }`}
              >
                {isMobile
                  ? playbackRate === 1
                    ? "倍速"
                    : `${playbackRate}x`
                  : `倍速 ${playbackRate === 1 ? "正常" : `${playbackRate}x`}`}
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-11 right-0 w-28 sm:w-32 max-h-48 overflow-y-auto bg-[#181c26]/95 backdrop-blur-xl border border-white/15 rounded-xl p-1.5 shadow-2xl z-40 space-y-0.5">
                  {[0.75, 1.0, 1.25, 1.5, 2.0, 3.0].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => changeSpeed(rate)}
                      className={`w-full px-2.5 py-1.5 rounded-lg text-xs text-left flex items-center justify-between ${
                        playbackRate === rate
                          ? "bg-sky-500 text-white font-semibold"
                          : "text-slate-200 hover:bg-white/10"
                      }`}
                    >
                      <span className="text-[11px] sm:text-xs">
                        {rate === 1.0 ? "1.0x 正常" : `${rate}x`}
                      </span>
                      {playbackRate === rate && <Check className="w-3 h-3" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Zoom / Aspect Ratio Crop Toggle */}
            <button
              onClick={() => setZoomCrop(!zoomCrop)}
              className={`hidden sm:flex px-2.5 py-1.5 rounded-lg text-xs font-semibold items-center gap-1 transition-all border ${
                zoomCrop
                  ? "bg-sky-500/25 border-sky-500/50 text-sky-300 shadow-sm"
                  : "bg-white/10 hover:bg-white/20 border-white/10 text-slate-300"
              }`}
              title="画面轻微缩放边缘裁切 (1.08x)"
            >
              <span>{zoomCrop ? "已裁切" : "画面裁切"}</span>
            </button>

            {/* Direct Download Button */}
            <button
              onClick={onOpenDownloadModal}
              className="hidden md:flex px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold items-center gap-1.5 transition-colors shadow-sm"
              title="将本视频下载保存到电脑"
            >
              <Download className="w-3.5 h-3.5" />
              <span>下载本片</span>
            </button>

            {/* Picture in Picture */}
            <button
              onClick={togglePiP}
              className="hidden sm:block p-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 transition-colors"
              title="画中画小窗播放"
            >
              <PictureInPicture2 className="w-4 h-4" />
            </button>

            {/* Fullscreen */}
            <button
              onClick={toggleFullscreen}
              className="p-1 sm:p-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 transition-colors"
              title={isFullscreen ? "退出全屏" : "全屏观看"}
            >
              {isFullscreen ? (
                <Minimize className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              ) : (
                <Maximize className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              )}
            </button>
          </div>
        </div>
      </div>
    )}

      {/* Episode Selector Drawer (Slide-in Overlay) */}
      {showEpisodeDrawer && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute inset-y-0 right-0 w-64 sm:w-80 bg-[#12151d]/95 backdrop-blur-2xl border-l border-white/15 z-40 flex flex-col p-4 shadow-2xl animate-in slide-in-from-right duration-200"
        >
          <div className="flex items-center justify-between pb-3 border-b border-white/10 shrink-0">
            <div className="flex items-center gap-2">
              <List className="w-4 h-4 text-sky-400" />
              <span className="text-sm font-bold text-white">剧集选集</span>
              <span className="text-xs text-slate-400">
                (共 {video.episodes?.length || 0} 集)
              </span>
            </div>
            <button
              onClick={() => setShowEpisodeDrawer(false)}
              className="p-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-300 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-3 space-y-1.5 pr-1">
            {video.episodes?.map((ep) => {
              const isCurrent = ep.index === currentEpIndex;
              return (
                <button
                  key={ep.index}
                  onClick={() => {
                    switchEpisode(ep);
                    setShowEpisodeDrawer(false);
                  }}
                  className={`w-full p-2.5 rounded-xl text-left text-xs flex items-center justify-between transition-all ${
                    isCurrent
                      ? "bg-sky-500 text-white font-bold shadow-md shadow-sky-500/20"
                      : "bg-white/5 hover:bg-white/10 text-slate-300 hover:text-white"
                  }`}
                >
                  <div className="min-w-0 pr-2">
                    <div className="truncate">
                      {ep.title || `第 ${ep.index} 集`}
                    </div>
                  </div>
                  {isCurrent && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/20 font-bold shrink-0">
                      当前
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
