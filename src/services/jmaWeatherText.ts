/**
 * 気象庁の予報文を解釈するモジュール。
 *
 * 気象庁の3日予報 (forecast/data/forecast/{code}.json) の `weathers` は
 * 「くもり昼過ぎから雷を伴い雨」のように **1日分をまとめた1文** で発表される。
 * 文中の「昼過ぎから」「朝まで」「のち」といった表現が、その日のどの時間帯に
 * どの天気になるかを示す唯一の手がかりなので、ここで時間帯ごとに分解する。
 *
 * これを行わずに1文をそのまま各時刻に適用すると、文中で最も目立つ現象
 * （例:「雷」）が終日表示されてしまい、実際には晴れている時間帯にも
 * 「雷雨」と出てしまう。
 */

/** 天気予報アイコン画像描画用の大分類。 */
export type WeatherCategory = "sun" | "sun-cloud" | "cloud" | "fog" | "rain" | "snow" | "thunder";

// 気象庁の予報文は「くもり」をひらがなで発表する（「曇」表記も念のため許容する）。
const CLOUDY_PATTERN = /くもり|曇/;
const SUNNY_PATTERN = /晴/;

export function weatherCategoryFromText(text: string): WeatherCategory {
  if (text.includes("雷")) return "thunder";
  if (text.includes("雪")) return "snow";
  if (text.includes("雨")) return "rain";
  if (text.includes("霧")) return "fog";
  if (CLOUDY_PATTERN.test(text) && SUNNY_PATTERN.test(text)) return "sun-cloud";
  if (CLOUDY_PATTERN.test(text)) return "cloud";
  if (SUNNY_PATTERN.test(text)) return "sun";
  return "cloud";
}

/**
 * 気象庁の予報文（例:「雨夜遅くくもり所により夜のはじめ頃まで雷を伴い非常に激しく降る所がある」）から
 * 表示用の短い天気名（例:「雷」「霧雨」「雪」）を抽出する。詳細な言い回しは表示上不要なため、
 * 該当する現象のうち最も特徴的なものを優先順位付きで1つ選ぶ。
 */
export function shortWeatherLabel(text: string): string {
  if (text.includes("雷") && text.includes("雨")) return "雷雨";
  if (text.includes("雷")) return "雷";
  if (text.includes("霧雨")) return "霧雨";
  if (text.includes("大雪")) return "大雪";
  if (text.includes("雪")) return "雪";
  if (text.includes("大雨")) return "大雨";
  if (text.includes("雨")) return "雨";
  if (text.includes("霧")) return "霧";
  if (CLOUDY_PATTERN.test(text) && SUNNY_PATTERN.test(text)) return "晴れ時々くもり";
  if (CLOUDY_PATTERN.test(text)) return "くもり";
  if (SUNNY_PATTERN.test(text)) return "晴れ";
  return "不明";
}

/** 気象庁の時間細分（https://www.jma.go.jp/jma/kishou/know/yougo_hp/mokuji.html）。 */
const TIME_BANDS: Array<{ term: string; startHour: number; endHour: number }> = [
  { term: "未明", startHour: 0, endHour: 3 },
  { term: "明け方", startHour: 3, endHour: 6 },
  { term: "朝のうち", startHour: 6, endHour: 9 },
  { term: "夜のはじめ頃", startHour: 18, endHour: 21 },
  { term: "夜遅く", startHour: 21, endHour: 24 },
  { term: "昼前", startHour: 9, endHour: 12 },
  { term: "昼過ぎ", startHour: 12, endHour: 15 },
  { term: "夕方", startHour: 15, endHour: 18 },
  { term: "日中", startHour: 9, endHour: 18 },
  { term: "午前中", startHour: 0, endHour: 12 },
  { term: "午前", startHour: 0, endHour: 12 },
  { term: "午後", startHour: 12, endHour: 24 },
  { term: "朝", startHour: 6, endHour: 9 },
  { term: "夜", startHour: 18, endHour: 24 },
  { term: "昼", startHour: 9, endHour: 18 },
];

// 長い語を先に並べる（「夜のはじめ頃」が「夜」にマッチしてしまうのを防ぐ）。
const TIME_BAND_PATTERN = TIME_BANDS.map((band) => band.term).join("|");
// 「昼過ぎから」「朝まで」「のち」、および「夜遅く雨」のような時間帯単独の指定を区切りとする。
const SPLIT_PATTERN = new RegExp(`(${TIME_BAND_PATTERN})(から|まで)?|(のち)`, "g");

const TIME_BAND_BY_TERM = new Map(TIME_BANDS.map((band) => [band.term, band]));

export interface WeatherSegment {
  /** 適用開始時刻（0-24、その日の JST での時）。 */
  startHour: number;
  /** 適用終了時刻（0-24、排他）。 */
  endHour: number;
  /** その時間帯の予報文（元の文の一部）。 */
  text: string;
}

/** 時間帯表現がその直後の天気に与える制約。 */
type Constraint =
  | { kind: "from"; hour: number }
  | { kind: "until"; hour: number }
  | { kind: "at"; startHour: number; endHour: number };

interface Chunk {
  text: string;
  constraint?: Constraint;
}

const DAY_START = 0;
const DAY_END = 24;

/** 予報文を、時間帯表現を区切りとしたテキスト片へ分解する。 */
function splitIntoChunks(normalized: string): Chunk[] {
  const chunks: Chunk[] = [];
  let current: Chunk = { text: "" };
  let lastIndex = 0;

  for (const match of normalized.matchAll(SPLIT_PATTERN)) {
    const [matched, bandTerm, direction] = match;
    current.text += normalized.slice(lastIndex, match.index);
    lastIndex = match.index + matched.length;

    const band = bandTerm ? TIME_BAND_BY_TERM.get(bandTerm) : undefined;
    if (bandTerm && !band) continue;

    chunks.push(current);
    if (!band) {
      // 「のち」: 前後関係のみが分かり、時刻は未確定。
      current = { text: "" };
    } else if (direction === "から") {
      current = { text: "", constraint: { kind: "from", hour: band.startHour } };
    } else if (direction === "まで") {
      current = { text: "", constraint: { kind: "until", hour: band.endHour } };
    } else {
      current = {
        text: "",
        constraint: { kind: "at", startHour: band.startHour, endHour: band.endHour },
      };
    }
  }

  current.text += normalized.slice(lastIndex);
  chunks.push(current);

  return chunks.filter((chunk) => chunk.text.length > 0);
}

/**
 * 予報文を時間帯ごとのセグメントに分解する。
 * 時間帯を示す表現が無い場合は、文全体を終日のセグメント1件として返す。
 */
export function parseWeatherSegments(text: string): WeatherSegment[] {
  const normalized = text.replace(/\s+/g, "");
  if (!normalized) return [];

  const chunks = splitIntoChunks(normalized);
  if (chunks.length === 0) {
    return [{ startHour: DAY_START, endHour: DAY_END, text: normalized }];
  }

  return resolveRanges(chunks);
}

/**
 * 各テキスト片に時間帯を割り当てる。
 *
 * 時間帯が明示された片を先に確定させ、残りの時間帯を、時間帯表現を持たない片へ
 * 文中の順序どおりに均等配分する。「朝まで雨」のように後ろの片が1日の前半を
 * 占める場合があるため、最後に開始時刻でソートして時系列順に並べ直す。
 */
function resolveRanges(chunks: Chunk[]): WeatherSegment[] {
  const ranges = new Map<number, { startHour: number; endHour: number }>();

  // 「◯◯から」は以降ずっと、「◯◯まで」は日の初めから、が既定の適用範囲。
  chunks.forEach((chunk, index) => {
    const constraint = chunk.constraint;
    if (!constraint) return;

    if (constraint.kind === "from") {
      ranges.set(index, { startHour: constraint.hour, endHour: DAY_END });
    } else if (constraint.kind === "until") {
      ranges.set(index, { startHour: DAY_START, endHour: constraint.hour });
    } else {
      ranges.set(index, { startHour: constraint.startHour, endHour: constraint.endHour });
    }
  });

  // 確定済みの範囲どうしが重ならないように、後続の「から」で手前の範囲を打ち切る。
  const fixed = [...ranges.entries()].sort((a, b) => a[1].startHour - b[1].startHour);
  for (let i = 0; i < fixed.length - 1; i++) {
    const [, currentRange] = fixed[i];
    const [, nextRange] = fixed[i + 1];
    if (currentRange.endHour > nextRange.startHour) currentRange.endHour = nextRange.startHour;
  }

  // 確定済みの範囲を除いた空き時間帯を求める。
  const free: Array<{ startHour: number; endHour: number }> = [];
  let cursor = DAY_START;
  for (const [, range] of fixed) {
    if (range.startHour > cursor) free.push({ startHour: cursor, endHour: range.startHour });
    cursor = Math.max(cursor, range.endHour);
  }
  if (cursor < DAY_END) free.push({ startHour: cursor, endHour: DAY_END });

  // 時間帯表現を持たない片へ、空き時間帯を文中の順序どおりに割り当てる。
  const unconstrained = chunks.map((_, index) => index).filter((index) => !ranges.has(index));
  distributeFreeRanges(unconstrained, free, ranges);

  return chunks
    .map((chunk, index) => ({
      ...(ranges.get(index) ?? { startHour: DAY_START, endHour: DAY_END }),
      text: chunk.text,
    }))
    .filter((segment) => segment.endHour > segment.startHour)
    .sort((a, b) => a.startHour - b.startHour);
}

function distributeFreeRanges(
  indices: number[],
  free: Array<{ startHour: number; endHour: number }>,
  ranges: Map<number, { startHour: number; endHour: number }>,
): void {
  if (indices.length === 0) return;

  if (free.length === 0) {
    // 空きが無い場合は終日扱いにする（他のセグメントが優先されるため実害は無い）。
    for (const index of indices) ranges.set(index, { startHour: DAY_START, endHour: DAY_END });
    return;
  }

  // 空き時間帯より片が多い場合は、最も広い空きを分割して割り当てる。
  let remaining = [...indices];
  for (const [position, slot] of free.entries()) {
    const isLast = position === free.length - 1;
    const count = isLast ? remaining.length : 1;
    if (count === 0) break;

    const step = (slot.endHour - slot.startHour) / count;
    for (let i = 0; i < count; i++) {
      ranges.set(remaining[i], {
        startHour: Math.round(slot.startHour + step * i),
        endHour: Math.round(slot.startHour + step * (i + 1)),
      });
    }
    remaining = remaining.slice(count);
    if (remaining.length === 0) break;
  }
}

/** 指定した時（0-23）に該当するセグメントの予報文を返す。 */
export function weatherTextAtHour(segments: WeatherSegment[], hour: number): string | undefined {
  const match = segments.find((s) => hour >= s.startHour && hour < s.endHour);
  return (match ?? segments[segments.length - 1])?.text;
}
