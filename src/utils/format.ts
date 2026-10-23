export function formatDuration(seconds: number): string {
  if (!seconds || !isFinite(seconds) || seconds < 0) return "00:00";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${mins.toString().padStart(2, "0")}:${secs
    .toString()
    .padStart(2, "0")}`;
}

export function isLikelyUrlOrCode(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (/https?:\/\/[a-zA-Z0-9\.\-_~:/?#\[\]@!$&'*+,;=%]+/i.test(trimmed)) return true;
  if (/^[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/.*)?$/i.test(trimmed)) return true;
  if (/^[a-zA-Z0-9_-]{6,32}$/.test(trimmed)) return true;
  return false;
}

export function extractCleanUrl(input: string): string {
  const trimmed = input.trim();
  const urlMatch = trimmed.match(/https?:\/\/[a-zA-Z0-9\.\-_~:/?#\[\]@!$&'*+,;=%]+/i);
  if (urlMatch) return urlMatch[0];
  const domainMatch = trimmed.match(/[a-zA-Z0-9-]+\.[a-zA-Z]{2,}(?:\/[^\s"'<>]*)?/i);
  if (domainMatch) return `https://${domainMatch[0]}`;
  return trimmed;
}
