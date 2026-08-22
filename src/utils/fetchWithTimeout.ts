const DEFAULT_TIMEOUT_MS = 10_000;

/**
 * 素の fetch はネットワークが詰まった場合に無期限に応答を待ち続けることがあり、
 * Discordのインタラクション（/weather 等）が永遠に応答しなくなる原因になる。
 * AbortController で必ず一定時間で打ち切る。
 */
export async function fetchWithTimeout(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
