import { useEffect, useState } from "react";

function detectIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  const envPlatform = (import.meta as any).env?.VITE_PLATFORM;
  if (envPlatform === "mobile") return true;
  if (envPlatform === "desktop") return false;

  // Real mobile operating systems (phones / phablets)
  const ua = typeof navigator !== "undefined" ? navigator.userAgent || "" : "";
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile/i.test(ua)) {
    return true;
  }

  // Touch device check with tablet/phone viewport bounds
  if (typeof navigator !== "undefined" && navigator.maxTouchPoints > 1 && window.innerWidth <= 1024) {
    return true;
  }

  return window.innerWidth < 768;
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
    const mq = window.matchMedia("(max-width: 767px)");
    mq.addEventListener("change", check);

    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
      mq.removeEventListener("change", check);
    };
  }, []);

  return isMobile;
}
