/**
 * 日本時間(JST)で日時を扱うためのヘルパー。
 *
 * Bot の実行環境のタイムゾーンは UTC であることが多く、Date のローカルタイム系メソッド
 * (getHours() / setHours() など) をそのまま使うと表示上の時刻が実際の日本時間からずれる。
 * 表示用の時刻整形と日付境界の判定は必ずこのモジュールを経由すること。
 */

export const JST_TIME_ZONE = "Asia/Tokyo";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: JST_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export interface JstParts {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
  /** 0-23 */
  hour: number;
  minute: number;
}

/** 与えられた時刻を JST の年月日時分に分解する。 */
export function jstParts(date: Date): JstParts {
  const values: Record<string, string> = {};
  for (const part of partsFormatter.formatToParts(date)) {
    if (part.type !== "literal") values[part.type] = part.value;
  }

  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    // hour12:false では真夜中を "24" として返す実装があるため 0 に正規化する。
    hour: Number(values.hour) % 24,
    minute: Number(values.minute),
  };
}

/** JST での時（0-23）。 */
export function jstHour(date: Date): number {
  return jstParts(date).hour;
}

/** JST の暦日で見た日数差（date - base）。同じ日なら 0、翌日なら 1。 */
export function jstDayDiff(date: Date, base: Date): number {
  const a = jstParts(date);
  const b = jstParts(base);
  return Math.round(
    (Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000,
  );
}

/** JST での「M/D」表記。 */
export function formatJstMonthDay(date: Date): string {
  const { month, day } = jstParts(date);
  return `${month}/${day}`;
}

/** JST での「HH:MM」表記。 */
export function formatJstHm(date: Date): string {
  const { hour, minute } = jstParts(date);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

const secondsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: JST_TIME_ZONE,
  second: "2-digit",
});

/** JST での「YYYY/MM/DD HH:MM:SS」表記（P2P地震情報のタイムスタンプ表記に合わせている）。 */
export function formatJstDateTime(date: Date): string {
  const { year, month, day, hour, minute } = jstParts(date);
  const second = secondsFormatter.format(date).padStart(2, "0");
  return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${second}`;
}

/** JST の暦日を表すキー（"2026-08-22"）。日ごとの集計に使う。 */
export function jstDateKey(date: Date): string {
  const { year, month, day } = jstParts(date);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}
