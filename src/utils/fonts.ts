import fs from "node:fs";
import path from "node:path";
import { GlobalFonts } from "@napi-rs/canvas";
import { logger } from "./logger";

export const FONT_FAMILY = "Noto Sans JP";

const FONT_PATHS = ["assets/fonts/NotoSansJP-Regular.ttf", "assets/fonts/NotoSansJP-Bold.ttf"];

let registered = false;

/**
 * 日本語フォントを登録する。未登録のままだと画像内の文字が豆腐（□）になるため、
 * ファイルが見つからない場合は警告を出して気付けるようにする。
 * 画像を生成するモジュールから重複して呼ばれても一度しか登録しない。
 */
export function ensureFontsRegistered(): void {
  if (registered) return;
  registered = true;

  for (const relativePath of FONT_PATHS) {
    const fontPath = path.resolve(process.cwd(), relativePath);
    if (fs.existsSync(fontPath)) {
      GlobalFonts.registerFromPath(fontPath, FONT_FAMILY);
    } else {
      logger.warn(`日本語フォントが見つかりません: ${fontPath}（画像内の文字が正しく表示されない可能性があります）`);
    }
  }
}
