import { logger } from "./utils/logger";
import { SECOND_MS } from "./utils/time";

/**
 * プロセスの終了処理（グレースフルシャットダウン）を一元管理するモジュール。
 *
 * Node.js は SIGTERM / SIGINT にリスナを1つでも登録すると既定の「プロセスを終了する」
 * 動作が無効化される。そのため、シグナルを購読する側が終了処理と exit まで責任を持つ
 * 必要がある。これを各モジュールに分散させると「登録したが終了させない」状態が生まれ、
 * systemd が TimeoutStopSec（既定90秒）まで待ってから SIGKILL することになるため、
 * シグナルの購読はこのモジュールだけが行う。
 *
 * 各サービスは onShutdown() で後始末を登録し、長時間の待機や HTTP リクエストには
 * shutdownSignal を渡して中断できるようにする。
 */

/** 後始末が完了しない場合に強制終了するまでの猶予。 */
const FORCE_EXIT_TIMEOUT_MS = 10 * SECOND_MS;

type ShutdownHook = () => void | Promise<void>;

const hooks: ShutdownHook[] = [];
const controller = new AbortController();

/** 終了処理の開始時に abort される signal。待機や通信の中断に使う。 */
export const shutdownSignal = controller.signal;

/** 終了処理中（またはすでに終了処理を開始した後）かどうか。 */
export function isShuttingDown(): boolean {
  return controller.signal.aborted;
}

/** プロセス終了時に実行する後始末を登録する。登録順に関係なく並行実行される。 */
export function onShutdown(hook: ShutdownHook): void {
  hooks.push(hook);
}

/** 終了時に自動で解除される setInterval。解除漏れによる終了遅延を防ぐ。 */
export function scheduleInterval(handler: () => void, intervalMs: number): void {
  const timer = setInterval(handler, intervalMs);
  onShutdown(() => clearInterval(timer));
}

/** 終了時に自動で解除される setTimeout。 */
export function scheduleTimeout(handler: () => void, delayMs: number): void {
  const timer = setTimeout(handler, delayMs);
  onShutdown(() => clearTimeout(timer));
}

let shutdownStarted = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownStarted) return;
  shutdownStarted = true;

  logger.info(`${signal} を受信しました。終了処理を開始します...`);
  controller.abort();

  // 後始末が何らかの理由で完了しない場合でも、systemd の停止待ちを長引かせない。
  const forceExit = setTimeout(() => {
    logger.warn(
      `終了処理が${FORCE_EXIT_TIMEOUT_MS / SECOND_MS}秒以内に完了しなかったため強制終了します。`,
    );
    process.exit(1);
  }, FORCE_EXIT_TIMEOUT_MS);

  const results = await Promise.allSettled(hooks.map(async (hook) => hook()));
  for (const result of results) {
    if (result.status === "rejected") {
      logger.error("終了処理中にエラーが発生しました。", result.reason);
    }
  }

  clearTimeout(forceExit);
  logger.info("終了処理が完了しました。");
  // 解放し切れていないハンドル（WebSocket・keep-alive 接続など）が残っていても
  // 確実にプロセスを終わらせるため、明示的に exit する。
  process.exit(0);
}

/** SIGTERM / SIGINT を購読して終了処理を開始する。起動時に一度だけ呼ぶこと。 */
export function installShutdownHandlers(): void {
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => void shutdown(signal));
  }
}
