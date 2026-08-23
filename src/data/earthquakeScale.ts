/**
 * P2P地震情報 API (JSON API v2) の maxScale / scale 値と震度表記の対応表。
 * 参照: https://www.p2pquake.net/develop/json_api_v2/
 */

/** API が返す震度値。しきい値比較で桁の意味を取り違えないよう名前付き定数として扱う。 */
export const SEISMIC_SCALE = {
  UNKNOWN: -1,
  S1: 10,
  S2: 20,
  S3: 30,
  S4: 40,
  S5_WEAK: 45,
  S5_WEAK_ESTIMATED: 46,
  S5_STRONG: 50,
  S6_WEAK: 55,
  S6_STRONG: 60,
  S7: 70,
} as const;

const SCALE_LABELS: Record<number, string> = {
  [SEISMIC_SCALE.UNKNOWN]: "不明",
  [SEISMIC_SCALE.S1]: "1",
  [SEISMIC_SCALE.S2]: "2",
  [SEISMIC_SCALE.S3]: "3",
  [SEISMIC_SCALE.S4]: "4",
  [SEISMIC_SCALE.S5_WEAK]: "5弱",
  [SEISMIC_SCALE.S5_WEAK_ESTIMATED]: "5弱以上（推定）",
  [SEISMIC_SCALE.S5_STRONG]: "5強",
  [SEISMIC_SCALE.S6_WEAK]: "6弱",
  [SEISMIC_SCALE.S6_STRONG]: "6強",
  [SEISMIC_SCALE.S7]: "7",
};

export function formatScale(scale: number): string {
  return SCALE_LABELS[scale] ?? `不明(${scale})`;
}

/** 震度の強さに応じた表示色（弱いほど緑、強いほど紫になるグラデーション）。 */
const SCALE_COLOR_STOPS: Array<[number, string]> = [
  [SEISMIC_SCALE.UNKNOWN, "#9e9e9e"],
  [SEISMIC_SCALE.S1, "#8bc34a"],
  [SEISMIC_SCALE.S2, "#cddc39"],
  [SEISMIC_SCALE.S3, "#ffeb3b"],
  [SEISMIC_SCALE.S4, "#ffc107"],
  [SEISMIC_SCALE.S5_WEAK, "#ff9800"],
  [SEISMIC_SCALE.S5_STRONG, "#f4511e"],
  [SEISMIC_SCALE.S6_WEAK, "#e53935"],
  [SEISMIC_SCALE.S6_STRONG, "#c62828"],
  [SEISMIC_SCALE.S7, "#8e24aa"],
];

/** 震度値に対応する表示色を返す（震度未満は下位の色にフォールバックする）。 */
export function scaleColor(scale: number): string {
  let color = SCALE_COLOR_STOPS[0][1];
  for (const [threshold, value] of SCALE_COLOR_STOPS) {
    if (scale >= threshold) color = value;
  }
  return color;
}
