import {
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import { config } from "../config";
import { formatScale } from "../data/earthquakeScale";

/**
 * このBotで使えるコマンドと自動通知機能の一覧を表示する。
 */

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("このBotで使えるコマンドの一覧を表示します");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setTitle("📖 コマンド一覧")
    .setDescription("防災・気象情報通知 Bot で使えるコマンドです。")
    .addFields(
      {
        name: "/weather <都道府県>",
        value: "指定した都道府県の時間別の天気・気温・発表中の警報を確認します。",
      },
      {
        name: "/config",
        value:
          "通知先チャンネルや地方区分ごとのロール紐付けを設定します（サーバー管理権限が必要）。\n" +
          "`channel set` `role set` `role unset` `show` のサブコマンドがあります。",
      },
      {
        name: "/earthquake-preview",
        value:
          "実際の地震を待たずに、地震情報通知の見た目をサンプルデータで確認します（サーバー管理権限が必要。メンションは送信されません）。",
      },
      {
        name: "/help",
        value: "このコマンド一覧を表示します。",
      },
      {
        name: "🔔 自動通知（コマンド不要）",
        value:
          // しきい値は設定で変更できるため、文言に直接書かず設定値から組み立てる。
          `震度${formatScale(config.earthquakeMinScale)}以上の地震情報と、気象庁の警報・特別警報・注意報の新規発表を、被災した地方のロール（未設定時は@here）宛に自動投稿します。\n` +
          "通知先チャンネルが未設定の場合は届きません。`/config channel set` で設定してください。",
      },
    )
    .setColor(0x4fc3f7)
    .setFooter({ text: "詳しい仕様はリポジトリの README を参照してください。" });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}
