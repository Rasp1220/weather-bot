/** 時刻付きデータ系列を扱う共通ヘルパー。気象庁APIの各時系列（天気・降水確率・気温）で使う。 */

export interface TimedPoint {
  time: Date;
}

/**
 * 時刻の昇順に並んだ系列から、対象時刻を含む区間の要素
 * （＝開始時刻が対象時刻以前で最も新しい要素）を返す。
 * 対象時刻が系列の開始より前の場合は undefined。
 */
export function findLatestAtOrBefore<T extends TimedPoint>(
  series: readonly T[],
  target: Date,
): T | undefined {
  const targetTime = target.getTime();
  let match: T | undefined;
  for (const point of series) {
    if (point.time.getTime() > targetTime) break;
    match = point;
  }
  return match;
}
