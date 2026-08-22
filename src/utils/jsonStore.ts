import fs from "node:fs";
import path from "node:path";
import { logger } from "./logger";

/** data/ 配下に置く JSON ファイル（実行時設定・警報の発表状況）の読み書き共通処理。 */

/** プロジェクトルートの data/ 配下のパスを解決する。 */
export function dataFilePath(fileName: string): string {
  return path.resolve(process.cwd(), "data", fileName);
}

/**
 * JSON ファイルを読み込む。存在しない場合や壊れている場合は undefined を返す。
 * 壊れたファイルで起動できなくなるのを避けるため、例外は握りつぶして警告を出すに留める。
 */
export function readJsonFile<T>(filePath: string, description: string): T | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch (error) {
    logger.warn(`${description}の読み込みに失敗しました。初期状態から開始します。`, error);
    return undefined;
  }
}

/**
 * JSON ファイルを保存する。
 * 書き込み途中でプロセスが停止してもファイルが壊れないよう、一時ファイルへ書いてから rename する。
 */
export function writeJsonFile(
  filePath: string,
  value: unknown,
  description: string,
  /** 人が読む設定ファイルは整形する。機械的な状態ファイルはサイズを抑えるため整形しない。 */
  pretty = true,
): void {
  const tempPath = `${filePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(value, null, pretty ? 2 : undefined), "utf-8");
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    logger.error(`${description}の保存に失敗しました。`, error);
    fs.rmSync(tempPath, { force: true });
  }
}
