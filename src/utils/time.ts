/** 時間計算で使う定数と待機ヘルパー。 */

export const SECOND_MS = 1_000;
export const MINUTE_MS = 60 * SECOND_MS;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/**
 * 指定時間だけ待機する。
 * signal が abort された場合は待機を打ち切り、false を返す（正常に待ち切った場合は true）。
 * 終了処理中に長い待機でプロセスの停止が遅れるのを防ぐために使う。
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);

  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve(false);
    };

    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve(true);
    }, ms);

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
