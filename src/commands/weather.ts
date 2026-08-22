import {
  AttachmentBuilder,
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  EmbedBuilder,
  SlashCommandBuilder,
} from "discord.js";
import { findPrefecture, searchPrefectures } from "../data/prefectures";
import { fetchPrefectureForecast } from "../services/jmaForecast";
import { renderForecastImage } from "../services/weatherImage";
import { logger } from "../utils/logger";

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

    const imageBuffer = renderForecastImage(prefecture.name, forecast);
    const attachment = new AttachmentBuilder(imageBuffer, { name: "forecast.png" });

    const embed = new EmbedBuilder()
      .setColor(0x4fc3f7)
      .setImage("attachment://forecast.png")
      .setTimestamp(new Date());

    await interaction.editReply({ embeds: [embed], files: [attachment] });
  } catch (error) {
    logger.error(`天気予報の取得に失敗しました (prefecture=${prefecture.name})`, error);
    await interaction.editReply("天気予報の取得中にエラーが発生しました。時間をおいて再度お試しください。");
  }
}
