import {
  AttachmentBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import { findPrefecture, searchPrefectures } from "../data/prefectures";
import { getRepresentativeOfficeCode } from "../services/jmaAreaMaster";
import {
  fetchPrefectureForecast,
  type ForecastPeriod,
  type PrefectureForecast,
  type TemperaturePoint,
} from "../services/jmaForecast";
import { weatherCategoryFromText, weatherTextAtHour } from "../services/jmaWeatherText";
import { fetchActiveWarnings } from "../services/jmaWarnings";
import { renderForecastImage } from "../services/weatherImage";
import type { WarningCodeInfo } from "../data/warningCodes";
import { formatJstMonthDay, jstDayDiff, jstHour } from "../utils/jst";
import { logger } from "../utils/logger";
import { HOUR_MS } from "../utils/time";
import { findLatestAtOrBefore } from "../utils/timeSeries";

/** 画像に表示する時間別予報の数（次の正時から1時間刻み）。 */
const HOURLY_STEPS = 6;

function formatHourLabel(hour: Date, now: Date): string {
  const dayDiff = jstDayDiff(hour, now);
  if (dayDiff <= 0) return `${jstHour(hour)}時`;
  if (dayDiff === 1) return `明日${jstHour(hour)}時`;
  return `${formatJstMonthDay(hour)} ${jstHour(hour)}時`;
}

/**
 * 時刻順に並んだ気温データを線形補間する。範囲外は端の値をそのまま使う。
 * 気象庁が発表するのは日ごとの最低・最高気温なので、時間別気温はその間の補間値になる。
 * 呼び出しごとに並べ替えないよう、ソート済みの配列を受け取る前提。
 */
function interpolateTemperature(sorted: TemperaturePoint[], hour: Date): number | undefined {
  if (sorted.length === 0) return undefined;

  const target = hour.getTime();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (target <= first.time.getTime()) return first.temperature;
  if (target >= last.time.getTime()) return last.temperature;

  for (let i = 0; i < sorted.length - 1; i++) {
    const before = sorted[i];
    const after = sorted[i + 1];
    if (target < before.time.getTime() || target > after.time.getTime()) continue;

    const span = after.time.getTime() - before.time.getTime();
    if (span === 0) return before.temperature;
    const ratio = (target - before.time.getTime()) / span;
    return before.temperature + (after.temperature - before.temperature) * ratio;
  }
  return undefined;
}

/** 次の正時を起点に、1時間刻みで HOURLY_STEPS 時間分の予報を組み立てる。 */
function buildHourlyForecast(forecast: PrefectureForecast, now: Date): PrefectureForecast {
  // JST は UTC との差が正時単位なので、絶対時刻を1時間単位で切り上げれば JST の次の正時になる。
  const startHour = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS + HOUR_MS;
  const sortedTemperatures = [...forecast.temperatures].sort(
    (a, b) => a.time.getTime() - b.time.getTime(),
  );

  const periods: ForecastPeriod[] = [];
  const temperatures: TemperaturePoint[] = [];

  for (let i = 0; i < HOURLY_STEPS; i++) {
    const time = new Date(startHour + i * HOUR_MS);
    // 気象庁の予報は日単位で発表されるため、その日の予報を取り出したうえで、
    // 予報文中の「昼過ぎから」などの表現を頼りにその時刻の天気まで絞り込む。
    const base = findLatestAtOrBefore(forecast.periods, time) ?? forecast.periods[0];
    const weatherText =
      (base?.segments ? weatherTextAtHour(base.segments, jstHour(time)) : undefined) ??
      base?.weatherText ??
      "不明";

    periods.push({
      time,
      periodLabel: formatHourLabel(time, now),
      weatherText,
      weatherCategory: weatherCategoryFromText(weatherText),
      pop: findLatestAtOrBefore(forecast.pops, time)?.pop,
    });

    const temperature = interpolateTemperature(sortedTemperatures, time);
    if (temperature != null) {
      temperatures.push({ time, temperature });
    }
  }

  return { ...forecast, periods, temperatures };
}

/** 発表中の警報・注意報を取得する。取得できなくても予報自体は表示したいので例外は投げない。 */
async function fetchWarningsForPrefecture(prefectureName: string): Promise<WarningCodeInfo[]> {
  const officeCode = getRepresentativeOfficeCode(prefectureName);
  if (!officeCode) return [];

  try {
    return await fetchActiveWarnings(officeCode);
  } catch (error) {
    logger.error(`警報情報の取得に失敗しました (prefecture=${prefectureName})`, error);
    return [];
  }
}

export const data = new SlashCommandBuilder()
  .setName("weather")
  .setDescription("指定した都道府県の気象庁天気予報を表示します")
  .addStringOption((option) =>
    option
      .setName("prefecture")
      .setDescription("都道府県名（例: 東京都）")
      .setRequired(true)
      .setAutocomplete(true),
  );

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const matches = searchPrefectures(interaction.options.getFocused());
  await interaction.respond(matches.map((p) => ({ name: p.name, value: p.name })));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const prefectureName = interaction.options.getString("prefecture", true);
  const prefecture = findPrefecture(prefectureName);

  if (!prefecture) {
    await interaction.reply({
      content: `「${prefectureName}」という都道府県は見つかりませんでした。候補から選択してください。`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply();

  try {
    const forecast = await fetchPrefectureForecast(prefecture.name);
    if (forecast.periods.length === 0) {
      await interaction.editReply("天気予報データを取得できませんでした。時間をおいて再度お試しください。");
      return;
    }

    const hourlyForecast = buildHourlyForecast(forecast, new Date());
    const warnings = await fetchWarningsForPrefecture(prefecture.name);

    const image = renderForecastImage(prefecture.name, hourlyForecast, warnings);
    await interaction.editReply({
      files: [new AttachmentBuilder(image, { name: "forecast.png" })],
    });
  } catch (error) {
    logger.error(`天気予報の取得に失敗しました (prefecture=${prefecture.name})`, error);
    await interaction.editReply("天気予報の取得中にエラーが発生しました。時間をおいて再度お試しください。");
  }
}
