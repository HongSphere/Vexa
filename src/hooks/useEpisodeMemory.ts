import { useCallback, useEffect, useMemo, useRef } from "react";
import { prefetchM3u8Index } from "../services/api";
import { useAppStore } from "../store/useAppStore";

export function normalizeSeriesKey(title: string | undefined): string {
  if (!title) return "";
  return title
    .replace(/第\s*\d+\s*[集话期章节]/g, "")
    .replace(/\b(?:ep?|episode)\s*\d+\b/gi, "")
    .replace(/[-_\s]+$/g, "")
    .trim();
}

export function useEpisodeMemory() {
  const currentVideo = useAppStore((s) => s.currentVideo);
  const seriesSkipMap = useAppStore((s) => s.seriesSkipMap);
  const setSeriesSkip = useAppStore((s) => s.setSeriesSkip);
  const switchEpisode = useAppStore((s) => s.switchEpisode);
  const showToast = useAppStore((s) => s.showToast);

  const seriesKey = useMemo(
    () => normalizeSeriesKey(currentVideo?.title),
    [currentVideo?.title]
  );

  const skipConfig = useMemo(() => {
    if (!seriesKey) return { introSec: 0, outroSec: 0 };
    return seriesSkipMap[seriesKey] || { introSec: 0, outroSec: 0 };
  }, [seriesKey, seriesSkipMap]);

  const prefetchedKeyRef = useRef<string>("");
  const introAppliedRef = useRef<string>("");
  const outroTriggeredRef = useRef<string>("");

  const episodeToken = `${currentVideo?.id || ""}:${currentVideo?.currentEpisodeIndex || 1}`;

  useEffect(() => {
    prefetchedKeyRef.current = "";
    introAppliedRef.current = "";
    outroTriggeredRef.current = "";
  }, [episodeToken]);

  const updateSkipConfig = useCallback(
    (partial: Partial<{ introSec: number; outroSec: number }>) => {
      if (!seriesKey) return;
      const next = {
        introSec: Math.max(0, Math.min(600, partial.introSec ?? skipConfig.introSec)),
        outroSec: Math.max(0, Math.min(600, partial.outroSec ?? skipConfig.outroSec)),
      };
      setSeriesSkip(seriesKey, next);
      showToast(`已记忆剧集跳过设置：片头 ${next.introSec}s / 片尾 ${next.outroSec}s`);
    },
    [seriesKey, skipConfig, setSeriesSkip, showToast]
  );

  const handleTimeTick = useCallback(
    (videoEl: HTMLVideoElement | null, currentTime: number, duration: number) => {
      if (!currentVideo || !duration || !Number.isFinite(duration)) return;

      if (
        skipConfig.introSec > 0 &&
        introAppliedRef.current !== episodeToken &&
        currentTime < skipConfig.introSec &&
        duration > skipConfig.introSec + 5
      ) {
        introAppliedRef.current = episodeToken;
        if (videoEl) {
          videoEl.currentTime = skipConfig.introSec;
          showToast(`已自动跳过片头 ${skipConfig.introSec} 秒`);
        }
      }

      const remaining = duration - currentTime;
      const episodes = currentVideo.episodes || [];
      const curIdx = currentVideo.currentEpisodeIndex || 1;
      const nextEp = episodes.find((e) => e.index === curIdx + 1);

      if (nextEp && remaining <= 15 && remaining > 0 && prefetchedKeyRef.current !== episodeToken) {
        prefetchedKeyRef.current = episodeToken;
        if (nextEp.url && nextEp.url.includes(".m3u8")) {
          prefetchM3u8Index(nextEp.url);
        }
      }

      if (
        nextEp &&
        skipConfig.outroSec > 0 &&
        remaining <= skipConfig.outroSec &&
        outroTriggeredRef.current !== episodeToken
      ) {
        outroTriggeredRef.current = episodeToken;
        switchEpisode(nextEp);
      }
    },
    [currentVideo, skipConfig, episodeToken, showToast, switchEpisode]
  );

  return {
    seriesKey,
    skipConfig,
    updateSkipConfig,
    handleTimeTick,
  };
}
