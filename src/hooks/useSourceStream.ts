import { useCallback, useEffect, useRef } from "react";
import { reportSourceHealth, subscribeMediaSourcesAppend } from "../services/api";
import { useAppStore } from "../store/useAppStore";

export function useSourceStream() {
  const currentVideo = useAppStore((s) => s.currentVideo);
  const appendCurrentVideoSources = useAppStore((s) => s.appendCurrentVideoSources);
  const switchMediaSource = useAppStore((s) => s.switchMediaSource);
  const showToast = useAppStore((s) => s.showToast);

  const failedSetRef = useRef<Set<string>>(new Set());
  const loadStartRef = useRef<number>(Date.now());

  useEffect(() => {
    failedSetRef.current.clear();
    loadStartRef.current = Date.now();
  }, [currentVideo?.url]);

  useEffect(() => {
    loadStartRef.current = Date.now();
  }, [currentVideo?.activeSourceId]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    subscribeMediaSourcesAppend((payload) => {
      if (payload && payload.targetUrl && Array.isArray(payload.sources)) {
        appendCurrentVideoSources(payload.targetUrl, payload.sources);
      }
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, [appendCurrentVideoSources]);

  const markPlaybackSuccess = useCallback((sourceId?: string) => {
    const sid = sourceId || useAppStore.getState().currentVideo?.activeSourceId;
    if (!sid) return;
    const elapsed = Math.max(10, Date.now() - loadStartRef.current);
    reportSourceHealth(sid, true, elapsed);
  }, []);

  const failoverNextSource = useCallback(
    (failedSourceId?: string): boolean => {
      const video = useAppStore.getState().currentVideo;
      if (!video || !video.sources || video.sources.length <= 1) return false;
      const curId = failedSourceId || video.activeSourceId || "";
      if (curId) {
        failedSetRef.current.add(curId);
        reportSourceHealth(curId, false, 8000);
      }
      const nextCandidate = video.sources.find(
        (s) =>
          s.sourceId !== curId &&
          !failedSetRef.current.has(s.sourceId) &&
          s.sourceType !== "jx_iframe"
      );
      if (!nextCandidate) return false;
      showToast(`当前线路异常，已自动切换至：${nextCandidate.sourceName}`);
      switchMediaSource(nextCandidate.sourceId);
      return true;
    },
    [showToast, switchMediaSource]
  );

  return {
    markPlaybackSuccess,
    failoverNextSource,
  };
}
