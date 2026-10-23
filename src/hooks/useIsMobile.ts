import { useEffect, useState } from "react";

function detectIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  const envPlatform = (import.meta as any).env?.VITE_PLATFORM;
  if (envPlatform === "mobile") return true;
  if (envPlatform === "desktop") return false;

  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  const isMobileOS = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  if (isMobileOS) return true;

  if (typeof (window as any).AndroidNative !== "undefined") {
    return true;
  }

  if (/Macintosh|Windows|Mac OS X|Linux/i.test(ua) && !isMobileOS) {
    return false;
  }

  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 1 && window.innerWidth < 768) {
    return true;
  }

  return false;
}

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState<boolean>(detectIsMobile);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const envPlatform = (import.meta as any).env?.VITE_PLATFORM;
    if (envPlatform === "mobile") {
      setIsMobile(true);
      return;
    }
    if (envPlatform === "desktop") {
      setIsMobile(false);
      return;
    }

    const check = () => {
      setIsMobile(detectIsMobile());
    };

    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);

    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  return isMobile;
}
