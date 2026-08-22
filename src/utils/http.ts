import { SECOND_MS } from "./time";

/**
 * 気象庁・P2P地震情報など外部APIへの JSON リクエスト共通処理。
 *
 * 素の fetch にはタイムアウトが無く、応答が返らないまま接続が保持されると
 * ポーリング全体が停滞し、プロセス終了も妨げられる。必ずこのモジュールを経由すること。
 */

const DEFAULT_TIMEOUT_MS = 10 * SECOND_MS;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`HTTP ${status} (${url})`);
    this.name = "HttpError";
  }
}

export interface FetchJsonOptions {
  /** 応答が無い場合に中断するまでの時間。既定 10 秒。 */
  timeoutMs?: number;
  /** 終了処理などで外部からリクエストを中断するための signal。 */
  signal?: AbortSignal;
}

export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal } = options;

  // AbortSignal.any() は Node 20 以降のため、タイムアウトと外部 signal を自前で束ねる。
  const controller = new AbortController();
  const abortFromCaller = (): void => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abortFromCaller, { once: true });

  const timer = setTimeout(
    () => controller.abort(new Error(`リクエストがタイムアウトしました: ${url}`)),
    timeoutMs,
  );

  try {
    if (signal?.aborted) abortFromCaller();

    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new HttpError(response.status, url);
    }
    return (await response.json()) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}
