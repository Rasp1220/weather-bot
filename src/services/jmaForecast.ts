import { getRepresentativeOfficeCode } from "./jmaAreaMaster";

const FORECAST_URL = (officeCode: string) =>
  `https://www.jma.go.jp/bosai/forecast/data/forecast/${officeCode}.json`;

/** 天気予報アイコン画像描画用の大分類。 */
export type WeatherCategory = "sun" | "sun-cloud" | "cloud" | "fog" | "rain" | "snow" | "thunder";

export interface ForecastPeriod {
  time: Date;
  /** 「今日夜」「明日朝」のような時間帯ラベル。 */
  periodLabel: string;
  /** 気象庁の予報文をそのまま使用（例: 晴れ後曇り）。 */
  weatherText: string;
  weatherCategory: WeatherCategory;
  /** 降水確率(%)。データが対応する時間帯に無ければ undefined。 */
  pop?: number;
}

export interface TemperaturePoint {
  time: Date;
  temperature: number;
}

export interface PopPoint {
  time: Date;
  pop: number;
}

export interface PrefectureForecast {
  officeName: string;
  periods: ForecastPeriod[];
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

function weatherCategoryFromText(text: string): WeatherCategory {
  if (text.includes("雷")) return "thunder";
  if (text.includes("雪")) return "snow";
  if (text.includes("雨")) return "rain";
  if (text.includes("霧")) return "fog";
  if (text.includes("曇") && text.includes("晴")) return "sun-cloud";
  if (text.includes("曇")) return "cloud";
  if (text.includes("晴")) return "sun";
  return "cloud";
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatPeriodLabel(time: Date, now: Date): string {
  const dayDiff = Math.round((startOfDay(time).getTime() - startOfDay(now).getTime()) / 86_400_000);
  const dayLabel =
    dayDiff <= 0 ? "今日" : dayDiff === 1 ? "明日" : dayDiff === 2 ? "明後日" : `${time.getMonth() + 1}/${time.getDate()}`;
  const hour = time.getHours();
  const timeLabel = hour < 6 ? "未明" : hour < 11 ? "朝" : hour < 17 ? "昼" : "夜";
  return `${dayLabel}${timeLabel}`;
}

/** popSeries は天気の時間帯とは別の刻み（概ね6時間毎）で発表されるため、最も近い時刻の値を採用する。 */
function findClosestPop(
  popSeries: JmaForecastTimeSeries | undefined,
  target: Date,
  maxDiffMs: number,
): number | undefined {
  const pops = popSeries?.areas?.[0]?.pops;
  if (!popSeries || !pops) return undefined;

  let bestIndex = -1;
  let bestDiff = Infinity;
  popSeries.timeDefines.forEach((iso, index) => {
    const diff = Math.abs(new Date(iso).getTime() - target.getTime());
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = index;
    }
  });

  if (bestIndex === -1 || bestDiff > maxDiffMs) return undefined;
  const value = pops[bestIndex];
  if (!value || value === "--") return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

export async function fetchPrefectureForecast(prefectureName: string): Promise<PrefectureForecast> {
  const officeCode = getRepresentativeOfficeCode(prefectureName);
  if (!officeCode) {
    throw new Error(
      `「${prefectureName}」に対応する気象庁予報区コードが見つかりませんでした。予報区データを準備中の可能性があるため、しばらくしてから再度お試しください。`,
    );
  }

  const response = await fetch(FORECAST_URL(officeCode));
  if (!response.ok) {
    throw new Error(`気象庁予報APIエラー: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as JmaForecastResponse;
  const report = data[0];
  const weatherSeries = report?.timeSeries?.[0];
  const popSeries = report?.timeSeries?.[1];
  const tempSeries = report?.timeSeries?.[2];
  const weatherArea = weatherSeries?.areas?.[0];

  if (!weatherSeries || !weatherArea?.weathers) {
    throw new Error("気象庁予報APIのレスポンス形式が想定と異なります。");
  }

  const now = new Date();
  const periods: ForecastPeriod[] = weatherSeries.timeDefines.map((iso, index) => {
    const time = new Date(iso);
    const weatherText = (weatherArea.weathers?.[index] ?? "").replace(/\s+/g, "") || "不明";
    return {
      time,
      periodLabel: formatPeriodLabel(time, now),
      weatherText,
      weatherCategory: weatherCategoryFromText(weatherText),
      pop: findClosestPop(popSeries, time, 3 * 3600_000),
    };
  });

  const temperatures: TemperaturePoint[] = (tempSeries?.timeDefines ?? [])
    .map((iso, index) => ({
      time: new Date(iso),
      temperature: Number(tempSeries?.areas?.[0]?.temps?.[index]),
    }))
    .filter((t) => Number.isFinite(t.temperature));

  const pops: PopPoint[] = (popSeries?.timeDefines ?? [])
    .map((iso, index) => {
      const value = popSeries?.areas?.[0]?.pops?.[index];
      return { time: new Date(iso), pop: value && value !== "--" ? Number(value) : NaN };
    })
    .filter((p) => Number.isFinite(p.pop));

  return {
    officeName: report?.publishingOffice ?? prefectureName,
    periods,
    temperatures,
    pops,
  };
}
