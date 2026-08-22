import {
  AttachmentBuilder,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from "discord.js";
import { findPrefecture, searchPrefectures } from "../data/prefectures";
import { getRepresentativeOfficeCode } from "../services/jmaAreaMaster";
import { fetchPrefectureForecast, type PrefectureForecast } from "../services/jmaForecast";
import { fetchActiveWarnings } from "../services/jmaWarnings";
import { renderForecastImage } from "../services/weatherImage";
import { logger } from "../utils/logger";

const FORECAST_WINDOW_MS = 6 * 3600_000;

/** 現在時刻から6時間先までの直近予報のみに絞り込む。 */
function narrowToNextHours(forecast: PrefectureForecast, now: Date): PrefectureForecast {
  const windowEnd = now.getTime() + FORECAST_WINDOW_MS;

  let currentIndex = 0;
  for (let i = 0; i < forecast.periods.length; i++) {
    if (forecast.periods[i].time.getTime() <= now.getTime()) currentIndex = i;
    else break;
  }

  const periods = forecast.periods
    .slice(currentIndex)
    .filter((period) => period.time.getTime() <= windowEnd);
  if (periods.length === 0 && forecast.periods[currentIndex]) {
    periods.push(forecast.periods[currentIndex]);
  }

  const temperatures = forecast.temperatures.filter(
    (point) => point.time.getTime() >= now.getTime() && point.time.getTime() <= windowEnd,
  );

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

    const narrowedForecast = narrowToNextHours(forecast, new Date());

    const officeCode = getRepresentativeOfficeCode(prefecture.name);
    let warnings: Awaited<ReturnType<typeof fetchActiveWarnings>> = [];
    if (officeCode) {
      try {
        warnings = await fetchActiveWarnings(officeCode);
      } catch (error) {
        logger.error(`警報情報の取得に失敗しました (prefecture=${prefecture.name})`, error);
      }
    }

    const imageBuffer = renderForecastImage(prefecture.name, narrowedForecast, warnings);
    const attachment = new AttachmentBuilder(imageBuffer, { name: "forecast.png" });

    await interaction.editReply({ files: [attachment] });
  } catch (error) {
    logger.error(`天気予報の取得に失敗しました (prefecture=${prefecture.name})`, error);
    await interaction.editReply("天気予報の取得中にエラーが発生しました。時間をおいて再度お試しください。");
  }
}
