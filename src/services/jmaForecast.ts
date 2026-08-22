import { getRepresentativeOfficeCode } from "./jmaAreaMaster";
import {
  parseWeatherSegments,
  weatherCategoryFromText,
  type WeatherCategory,
  type WeatherSegment,
} from "./jmaWeatherText";
import { fetchJson } from "../utils/http";
import { formatJstMonthDay, jstDateKey, jstDayDiff, jstHour } from "../utils/jst";
import { findLatestAtOrBefore } from "../utils/timeSeries";

export type { WeatherCategory } from "./jmaWeatherText";

const forecastUrl = (officeCode: string): string =>
  `https://www.jma.go.jp/bosai/forecast/data/forecast/${officeCode}.json`;

export interface ForecastPeriod {
  time: Date;
  /** 「今日夜」「明日朝」のような時間帯ラベル。 */
  periodLabel: string;
  /** 気象庁の予報文をそのまま使用（例: 晴れ後曇り）。 */
  weatherText: string;
  weatherCategory: WeatherCategory;
  /** 降水確率(%)。データが対応する時間帯に無ければ undefined。 */
  pop?: number;
  /**
   * 予報文を時間帯ごとに分解したもの。
   * 気象庁の予報文は1日分がまとまった1文なので、時刻別に表示する際はこれを使う。
   */
  segments?: WeatherSegment[];
}

export interface TemperaturePoint {
  time: Date;
  temperature: number;
}

/** 日ごとの最高・最低気温。気象庁は時間別気温を発表しないため、予報値はこの粒度が上限。 */
export interface DailyTemperature {
  /** その日を代表する時刻（JST のその日のいずれかの発表時刻）。 */
  date: Date;
  min?: number;
  max?: number;
}

export interface PopPoint {
  time: Date;
  pop: number;
}

export interface PrefectureForecast {
  officeName: string;
  periods: ForecastPeriod[];
  /** 日別の最高・最低気温（今日・明日など）。 */
  dailyTemperatures: DailyTemperature[];
  /** 気温の生データ（最低・最高の発表時刻）。時間別気温の補間に使用する。 */
  temperatures: TemperaturePoint[];
  /** 降水確率の生データ（概ね6時間毎）。時間単位の予報を組み立てる際に使用する。 */
  pops: PopPoint[];
}

interface JmaForecastArea {
  area: { name: string; code: string };
  weatherCodes?: string[];
  weathers?: string[];
  pops?: string[];
  temps?: string[];
  /** 週間予報 (data[1]) のみが持つ、明示的な最低・最高気温。 */
  tempsMin?: string[];
  tempsMax?: string[];
}

interface JmaForecastTimeSeries {
  timeDefines: string[];
  areas: JmaForecastArea[];
}

interface JmaForecastReport {
  publishingOffice?: string;
  timeSeries?: JmaForecastTimeSeries[];
}

type JmaForecastResponse = JmaForecastReport[];

function formatPeriodLabel(time: Date, now: Date): string {
  const dayDiff = jstDayDiff(time, now);
  const dayLabel =
    dayDiff <= 0 ? "今日" : dayDiff === 1 ? "明日" : dayDiff === 2 ? "明後日" : formatJstMonthDay(time);
  const hour = jstHour(time);
  const timeLabel = hour < 6 ? "未明" : hour < 11 ? "朝" : hour < 17 ? "昼" : "夜";
  return `${dayLabel}${timeLabel}`;
}

/** 「--」など数値として扱えない値を除外しつつ数値へ変換する。 */
function parseNumeric(value: string | undefined): number | undefined {
  if (!value || value === "--") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** 気象庁の時系列（timeDefines と値配列の組）を、時刻付きの配列へ変換する。 */
function toNumericSeries<T>(
  series: JmaForecastTimeSeries | undefined,
  values: (area: JmaForecastArea) => string[] | undefined,
  build: (time: Date, value: number) => T,
): T[] {
  const area = series?.areas?.[0];
  if (!series || !area) return [];

  const rawValues = values(area) ?? [];
  const points: T[] = [];
  series.timeDefines.forEach((iso, index) => {
    const value = parseNumeric(rawValues[index]);
    if (value != null) points.push(build(new Date(iso), value));
  });
  return points;
}

/**
 * 日別の最高・最低気温を組み立てる。
 *
 * 3日予報 (data[0].timeSeries[2]) の `temps` は「その日の 00 時ごろ＝最低気温、
 * 09 時ごろ＝最高気温」という発表時刻の対で並んでおり、時間別の気温ではない。
 * 発表時刻が欠ける日（夕方の発表では当日の最低気温が落ちるなど）に備えて、
 * 週間予報 (data[1]) が持つ明示的な tempsMin / tempsMax で補完する。
 */
function buildDailyTemperatures(
  shortTermSeries: JmaForecastTimeSeries | undefined,
  weeklySeries: JmaForecastTimeSeries | undefined,
): DailyTemperature[] {
  const byDate = new Map<string, DailyTemperature>();

  const entryFor = (time: Date): DailyTemperature => {
    const key = jstDateKey(time);
    const existing = byDate.get(key);
    if (existing) return existing;

    const created: DailyTemperature = { date: time };
    byDate.set(key, created);
    return created;
  };

  const shortTermArea = shortTermSeries?.areas?.[0];
  shortTermSeries?.timeDefines.forEach((iso, index) => {
    const value = parseNumeric(shortTermArea?.temps?.[index]);
    if (value == null) return;

    const time = new Date(iso);
    const entry = entryFor(time);
    // 09 時発表が最高気温、00 時発表が最低気温。念のため大小でも補正する。
    if (jstHour(time) >= 9) {
      entry.max = entry.max == null ? value : Math.max(entry.max, value);
    } else {
      entry.min = entry.min == null ? value : Math.min(entry.min, value);
    }
  });

  const weeklyArea = weeklySeries?.areas?.[0];
  weeklySeries?.timeDefines.forEach((iso, index) => {
    const time = new Date(iso);
    const entry = entryFor(time);
    entry.min ??= parseNumeric(weeklyArea?.tempsMin?.[index]);
    entry.max ??= parseNumeric(weeklyArea?.tempsMax?.[index]);
  });

  return [...byDate.values()]
    .filter((entry) => entry.min != null || entry.max != null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

export async function fetchPrefectureForecast(prefectureName: string): Promise<PrefectureForecast> {
  const officeCode = getRepresentativeOfficeCode(prefectureName);
  if (!officeCode) {
    throw new Error(
      `「${prefectureName}」に対応する気象庁予報区コードが見つかりませんでした。予報区データを準備中の可能性があるため、しばらくしてから再度お試しください。`,
    );
  }

  const data = await fetchJson<JmaForecastResponse>(forecastUrl(officeCode));

  const report = data[0];
  const weatherSeries = report?.timeSeries?.[0];
  const popSeries = report?.timeSeries?.[1];
  const tempSeries = report?.timeSeries?.[2];
  const weatherArea = weatherSeries?.areas?.[0];

  if (!weatherSeries || !weatherArea?.weathers) {
    throw new Error("気象庁予報APIのレスポンス形式が想定と異なります。");
  }

  const pops = toNumericSeries(popSeries, (area) => area.pops, (time, pop) => ({ time, pop }));
  // data[1] は週間予報。当日・翌日の気温が欠けている場合の補完に使う。
  const dailyTemperatures = buildDailyTemperatures(tempSeries, data[1]?.timeSeries?.[1]);
  const temperatures = toNumericSeries(
    tempSeries,
    (area) => area.temps,
    (time, temperature) => ({ time, temperature }),
  );

  const now = new Date();
  const periods: ForecastPeriod[] = weatherSeries.timeDefines.map((iso, index) => {
    const time = new Date(iso);
    const weatherText = (weatherArea.weathers?.[index] ?? "").replace(/\s+/g, "") || "不明";
    return {
      time,
      periodLabel: formatPeriodLabel(time, now),
      weatherText,
      weatherCategory: weatherCategoryFromText(weatherText),
      pop: findLatestAtOrBefore(pops, time)?.pop,
      segments: parseWeatherSegments(weatherText),
    };
  });

  return {
    officeName: report?.publishingOffice ?? prefectureName,
    periods,
    dailyTemperatures,
    temperatures,
    pops,
  };
}
