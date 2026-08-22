import {
  AttachmentBuilder,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { findPrefecture, searchPrefectures } from "../data/prefectures";
import { getRepresentativeOfficeCode } from "../services/jmaAreaMaster";
import {
  fetchPrefectureForecast,
  type ForecastPeriod,
  type PopPoint,
  type PrefectureForecast,
  type TemperaturePoint,
} from "../services/jmaForecast";
import { fetchActiveWarnings } from "../services/jmaWarnings";
import { renderForecastImage } from "../services/weatherImage";
import { logger } from "../utils/logger";

const HOURLY_STEPS = 6;

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatHourLabel(hour: Date, now: Date): string {
  const dayDiff = Math.round((startOfDay(hour).getTime() - startOfDay(now).getTime()) / 86_400_000);
  if (dayDiff <= 0) return `${hour.getHours()}時`;
  if (dayDiff === 1) return `明日${hour.getHours()}時`;
  return `${hour.getMonth() + 1}/${hour.getDate()} ${hour.getHours()}時`;
}

/** その時刻を含む予報時間帯（開始時刻が対象時刻以前で最も新しいもの）を探す。 */
function findPeriodForHour(periods: ForecastPeriod[], hour: Date): ForecastPeriod | undefined {
  let match: ForecastPeriod | undefined;
  for (const period of periods) {
    if (period.time.getTime() <= hour.getTime()) match = period;
    else break;
  }
  return match ?? periods[0];
}

/** その時刻を含む降水確率の時間帯（概ね6時間毎）の値を返す。 */
function findPopForHour(pops: PopPoint[], hour: Date): number | undefined {
  let match: PopPoint | undefined;
  for (const point of pops) {
    if (point.time.getTime() <= hour.getTime()) match = point;
    else break;
  }
  return match?.pop;
}

/** 気温の既知の2点間を線形補間する。範囲外は端の値をそのまま使う。 */
function interpolateTemperature(temperatures: TemperaturePoint[], hour: Date): number | undefined {
  if (temperatures.length === 0) return undefined;
  const sorted = [...temperatures].sort((a, b) => a.time.getTime() - b.time.getTime());
  const target = hour.getTime();

  if (target <= sorted[0].time.getTime()) return sorted[0].temperature;
  const last = sorted[sorted.length - 1];
  if (target >= last.time.getTime()) return last.temperature;

  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (target >= a.time.getTime() && target <= b.time.getTime()) {
      const ratio = (target - a.time.getTime()) / (b.time.getTime() - a.time.getTime());
      return a.temperature + (b.temperature - a.temperature) * ratio;
    }
  }
  return undefined;
}

/** 次の正時を起点に、1時間刻みでHOURLY_STEPS時間分（6時間先まで）の予報を組み立てる。 */
function buildHourlyForecast(forecast: PrefectureForecast, now: Date): PrefectureForecast {
  const startHour = new Date(now);
  startHour.setMinutes(0, 0, 0);
  startHour.setHours(startHour.getHours() + 1);

  const periods: ForecastPeriod[] = [];
  const temperatures: TemperaturePoint[] = [];

  for (let i = 0; i < HOURLY_STEPS; i++) {
    const hourTime = new Date(startHour.getTime() + i * 3600_000);
    const base = findPeriodForHour(forecast.periods, hourTime);

    periods.push({
      time: hourTime,
      periodLabel: formatHourLabel(hourTime, now),
      weatherText: base?.weatherText ?? "不明",
      weatherCategory: base?.weatherCategory ?? "cloud",
      pop: findPopForHour(forecast.pops, hourTime),
    });

    const temperature = interpolateTemperature(forecast.temperatures, hourTime);
    if (temperature != null) {
      temperatures.push({ time: hourTime, temperature });
    }
  }

  return { ...forecast, periods, temperatures };
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
  const focused = interaction.options.getFocused();
  const matches = searchPrefectures(focused);
  await interaction.respond(matches.map((p) => ({ name: p.name, value: p.name })));
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const prefectureName = interaction.options.getString("prefecture", true);
  const prefecture = findPrefecture(prefectureName);

  if (!prefecture) {
    await interaction.reply({
      content: `「${prefectureName}」という都道府県は見つかりませんでした。候補から選択してください。`,
      ephemeral: true,
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

    const officeCode = getRepresentativeOfficeCode(prefecture.name);
    let warnings: Awaited<ReturnType<typeof fetchActiveWarnings>> = [];
    if (officeCode) {
      try {
        warnings = await fetchActiveWarnings(officeCode);
      } catch (error) {
        logger.error(`警報情報の取得に失敗しました (prefecture=${prefecture.name})`, error);
      }
    }

    const imageBuffer = renderForecastImage(prefecture.name, hourlyForecast, warnings);
    const attachment = new AttachmentBuilder(imageBuffer, { name: "forecast.png" });

    await interaction.editReply({ files: [attachment] });
  } catch (error) {
    logger.error(`天気予報の取得に失敗しました (prefecture=${prefecture.name})`, error);
    await interaction.editReply("天気予報の取得中にエラーが発生しました。時間をおいて再度お試しください。");
  }
}
