import {
  ChannelType,
  EmbedBuilder,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
} from "discord.js";
import type { RegionName } from "../data/prefectures";
import { NOTIFY_MIN_LEVEL } from "../data/warningCodes";
import { getWarningWatcherStatus } from "../services/jmaWarnings";
import {
  getAllChannelIds,
  getAllRegionRoleIds,
  REGION_NAMES,
  setChannelId,
  setRegionRoleId,
  type NotificationTarget,
} from "../services/settings";
import { formatJstDateTime } from "../utils/jst";

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
            option
              .setName("role")
              .setDescription("その地方の災害情報でメンションするロール")
              .setRequired(true),
          ),
      )
      .addSubcommand((sub) =>
        sub
          .setName("unset")
          .setDescription("地方区分のロール設定を解除します（以後 @here で通知）")
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

/** 自動通知に必要な権限。1つでも欠けると通知が届かないため、設定時にその場で検査する。 */
const REQUIRED_NOTIFICATION_PERMISSIONS = [
  { flag: PermissionFlagsBits.ViewChannel, label: "チャンネルを見る" },
  { flag: PermissionFlagsBits.SendMessages, label: "メッセージを送信" },
  { flag: PermissionFlagsBits.EmbedLinks, label: "埋め込みリンク" },
  { flag: PermissionFlagsBits.MentionEveryone, label: "@everyone、@here、全てのロールにメンション" },
] as const;

/** Bot が通知チャンネルに対して持っていない権限の名称一覧を返す。 */
function findMissingPermissions(
  interaction: ChatInputCommandInteraction,
  channel: GuildBasedChannel,
): string[] {
  const me = interaction.guild?.members.me;
  if (!me) return [];

  const permissions = channel.permissionsFor(me);
  if (!permissions) return [];

  return REQUIRED_NOTIFICATION_PERMISSIONS.filter(({ flag }) => !permissions.has(flag)).map(
    ({ label }) => label,
  );
}

async function setNotificationChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  const target = interaction.options.getString("target", true) as NotificationTarget;
  const selected = interaction.options.getChannel("channel", true);

  setChannelId(target, selected.id);

  // 「チャンネルは設定したのに通知が来ない」の大半は Bot の権限不足なので、その場で知らせる。
  const guildChannel = interaction.guild?.channels.cache.get(selected.id);
  const missing = guildChannel ? findMissingPermissions(interaction, guildChannel) : [];

  const lines = [`✅ ${TARGET_LABELS[target]}の通知先チャンネルを <#${selected.id}> に設定しました。`];
  if (missing.length > 0) {
    lines.push(
      "",
      `⚠️ このチャンネルで Bot に以下の権限が不足しています。付与しないと通知が届きません。`,
      ...missing.map((label) => `・${label}`),
    );
  }

  await replyPrivately(interaction, lines.join("\n"));
}

async function setRegionRole(interaction: ChatInputCommandInteraction): Promise<void> {
  const region = interaction.options.getString("region", true) as RegionName;
  const role = interaction.options.getRole("role", true);

  setRegionRoleId(region, role.id);
  await replyPrivately(
    interaction,
    `✅ ${region}地方の災害通知ロールを <@&${role.id}> に設定しました。`,
  );
}

async function unsetRegionRole(interaction: ChatInputCommandInteraction): Promise<void> {
  const region = interaction.options.getString("region", true) as RegionName;

  setRegionRoleId(region, null);
  await replyPrivately(
    interaction,
    `✅ ${region}地方のロール設定を解除しました（以後 @here で通知されます）。`,
  );
}

/**
 * 警報の自動通知が実際に動いているかを可視化する。
 * 「警報が出ているのに通知が来ない」ときに、エリアマスタ未取得・チャンネル未設定・
 * 権限不足・気象庁API障害のどれで止まっているかをログを見ずに切り分けられるようにする。
 */
function buildWarningWatcherLines(interaction: ChatInputCommandInteraction): string[] {
  const status = getWarningWatcherStatus();
  const lines: string[] = [`通知しきい値: 警戒レベル${NOTIFY_MIN_LEVEL}以上（警報・特別警報）`];

  lines.push(
    `監視中の予報区: ${
      status.officeCount > 0
        ? `${status.officeCount}件`
        : "0件 ⚠️ 気象庁エリアマスタを取得できていません"
    }`,
  );
  lines.push(
    `最終チェック: ${
      status.lastPollFinishedAt ? formatJstDateTime(status.lastPollFinishedAt) : "未実行"
    }`,
  );
  if (status.fetchErrorCount > 0) {
    lines.push(`⚠️ 直近のチェックで${status.fetchErrorCount}件の予報区の取得に失敗しました。`);
  }
  lines.push(
    `最終通知: ${status.lastNotifiedAt ? formatJstDateTime(status.lastNotifiedAt) : "なし"}`,
  );
  if (status.pendingOfficeCount > 0) {
    lines.push(`⚠️ 未送信の警報: ${status.pendingOfficeCount}件（次回チェックで再送します）`);
  }
  if (status.lastDeliveryError) {
    lines.push(`⚠️ ${status.lastDeliveryError}`);
  }

  const warningChannelId = getAllChannelIds().warning;
  const warningChannel = warningChannelId
    ? interaction.guild?.channels.cache.get(warningChannelId)
    : undefined;
  if (warningChannel) {
    const missing = findMissingPermissions(interaction, warningChannel);
    lines.push(
      missing.length > 0
        ? `⚠️ 通知チャンネルの権限不足: ${missing.join("、")}`
        : "通知チャンネルの権限: OK",
    );
  }

  return lines;
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
    return `${region}: ${roleId ? `<@&${roleId}>` : "未設定（@here で通知）"}`;
  });

  const embed = new EmbedBuilder()
    .setTitle("⚙️ 現在の設定")
    .addFields(
      { name: "通知先チャンネル", value: channelLines.join("\n") },
      { name: "地方ロール紐付け", value: roleLines.join("\n") },
      { name: "気象警報の自動通知", value: buildWarningWatcherLines(interaction).join("\n") },
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
