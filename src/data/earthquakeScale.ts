/**
 * P2P地震情報 API (JSON API v2) の maxScale / scale 値と震度表記の対応表。
 * 参照: https://www.p2pquake.net/develop/json_api_v2/
 */

const SCALE_TABLE: Record<number, string> = {
  [-1]: "不明",
  10: "1",
  20: "2",
  30: "3",
  40: "4",
  45: "5弱",
  46: "5弱以上（推定）",
  50: "5強",
  55: "6弱",
  60: "6強",
  70: "7",
};

export function formatScale(scale: number): string {
  return SCALE_TABLE[scale] ?? `不明(${scale})`;
}

/** 「震度3以上」フィルタのしきい値。scale値 30 = 震度3。 */
export const MIN_NOTIFY_SCALE = 30;
