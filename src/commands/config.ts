import {
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { RegionName } from "../data/prefectures";
import {
  getAllChannelIds,
  getAllRegionRoleIds,
  REGION_NAMES,
  setChannelId,
  setRegionRoleId,
  type NotificationTarget,
} from "../services/settings";

const TARGET_LABELS: Record<NotificationTarget, string> = {
  earthquake: "地震速報",
  warning: "気象警報・注意報",
};

export const data = new SlashCommandBuilder()
  .setName("config")
  .setDescription("通知先チャンネルや地方ロールの紐付けを設定します（サーバー管理権限が必要）")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild)
  .addSubcommandGroup((group) =>
    group
      .setName("channel")
      .setDescription("通知先チャンネルの設定")
      .addSubcommand((sub) =>
        sub
          .setName("set")
          .setDescription("通知先チャンネルを設定します")
          .addStringOption((option) =>
            option
              .setName("target")
              .setDescription("通知の種類")
              .setRequired(true)
              .addChoices(
                { name: "地震速報", value: "earthquake" },
                { name: "気象警報・注意報", value: "warning" },
              ),
          )
          .addChannelOption((option) =>
            option
              .setName("channel")
              .setDescription("通知先チャンネル")
              .setRequired(true)
              .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
          ),
      ),
  )
  .addSubcommandGroup((group) =>
    group
      .setName("role")
      .setDescription("地方区分とロールの紐付け設定")
      .addSubcommand((sub) =>
        sub
          .setName("set")
          .setDescription("地方区分に対応するロールを設定します")
          .addStringOption((option) =>
            option
              .setName("region")
              .setDescription("地方区分")
              .setRequired(true)
              .addChoices(...REGION_NAMES.map((name) => ({ name, value: name }))),
          )
          .addRoleOption((option) =>
            option.setName("role").setDescription("警報発表時にメンションするロール").setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("unset")
          .setDescription("地方区分のロール設定を解除します（以後メンションなしで通知）")
          .addStringOption((option) =>
            option
              .setName("region")
              .setDescription("地方区分")
              .setRequired(true)
              .addChoices(...REGION_NAMES.map((name) => ({ name, value: name }))),
          ),
      ),
  )
  .addSubcommand((sub) => sub.setName("show").setDescription("現在の設定を表示します"));

/** 変更内容の通知は本人にだけ見えれば十分なので、常に ephemeral で返す。 */
function replyPrivately(
  interaction: ChatInputCommandInteraction,
  content: string,
): Promise<unknown> {
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

async function setNotificationChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getString("target", true) as NotificationTarget;
  const channel = interaction.options.getChannel("channel", true);

  setChannelId(target, channel.id);
  await replyPrivately(
    interaction,
    `✅ ${TARGET_LABELS[target]}の通知先チャンネルを <#${channel.id}> に設定しました。`,
  );
}

async function setRegionRole(interaction: ChatInputCommandInteraction): Promise<void> {
  const region = interaction.options.getString("region", true) as RegionName;
  const role = interaction.options.getRole("role", true);

  setRegionRoleId(region, role.id);
  await replyPrivately(
    interaction,
    `✅ ${region}地方の警報通知ロールを <@&${role.id}> に設定しました。`,
  );
}

async function unsetRegionRole(interaction: ChatInputCommandInteraction): Promise<void> {
  const region = interaction.options.getString("region", true) as RegionName;

  setRegionRoleId(region, null);
  await replyPrivately(
    interaction,
    `✅ ${region}地方のロール設定を解除しました（以後メンションなしで通知されます）。`,
  );
}

async function showSettings(interaction: ChatInputCommandInteraction): Promise<void> {
  const channels = getAllChannelIds();
  const regionRoleIds = getAllRegionRoleIds();

  const channelLines = (Object.keys(TARGET_LABELS) as NotificationTarget[]).map((target) => {
    const channelId = channels[target];
    return `${TARGET_LABELS[target]}: ${channelId ? `<#${channelId}>` : "未設定"}`;
  });

  const roleLines = REGION_NAMES.map((region) => {
    const roleId = regionRoleIds[region];
    return `${region}: ${roleId ? `<@&${roleId}>` : "未設定（メンションなし）"}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("⚙️ 現在の設定")
    .addFields(
      { name: "通知先チャンネル", value: channelLines.join("\n") },
      { name: "地方ロール紐付け", value: roleLines.join("\n") },
    )
    .setColor(0x4fc3f7)
    .setTimestamp(new Date());

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

/** 「サブコマンドグループ/サブコマンド」をキーにしたハンドラ表。グループ無しは "" で表す。 */
const HANDLERS: Record<string, (interaction: ChatInputCommandInteraction) => Promise<void>> = {
  "channel/set": setNotificationChannel,
  "role/set": setRegionRole,
  "role/unset": unsetRegionRole,
  "/show": showSettings,
};

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const group = interaction.options.getSubcommandGroup(false) ?? "";
  const subcommand = interaction.options.getSubcommand();

  const handler = HANDLERS[`${group}/${subcommand}`];
  if (!handler) {
    await replyPrivately(interaction, "未対応のサブコマンドです。");
    return;
  }

  await handler(interaction);
}
