import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  InteractionContextType,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  type ChatInputCommandInteraction,
  type MessageComponentInteraction,
} from "discord.js";
import { config } from "../config";
import { SEISMIC_SCALE } from "../data/earthquakeScale";
import {
  collectAffectedRegions,
  summarizeByPrefecture,
  type JmaQuakeMessage,
} from "../services/earthquake";
import { renderEarthquakeInfoImage, renderEpicenterMapImage } from "../services/earthquakeImage";
import { formatJstDateTime } from "../utils/jst";
import { logger } from "../utils/logger";

/**
 * 本物の地震を待たずに通知の見た目を確認するためのテストコマンド。
 * 震度・津波情報はセレクトメニューで選び、ボタンを押すとサンプルデータで
 * 実際の通知と同じ画像をチャンネルに投稿する（メンションは飛ばさない）。
 */

const SELECT_TIMEOUT_MS = 5 * 60 * 1000;

const SCALE_CUSTOM_ID = "eqpreview:scale";
const TSUNAMI_CUSTOM_ID = "eqpreview:tsunami";
const SUBMIT_CUSTOM_ID = "eqpreview:submit";
const CANCEL_CUSTOM_ID = "eqpreview:cancel";

const SCALE_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "震度1", value: String(SEISMIC_SCALE.S1) },
  { label: "震度2", value: String(SEISMIC_SCALE.S2) },
  { label: "震度3", value: String(SEISMIC_SCALE.S3) },
  { label: "震度4", value: String(SEISMIC_SCALE.S4) },
  { label: "震度5弱", value: String(SEISMIC_SCALE.S5_WEAK) },
  { label: "震度5強", value: String(SEISMIC_SCALE.S5_STRONG) },
  { label: "震度6弱", value: String(SEISMIC_SCALE.S6_WEAK) },
  { label: "震度6強", value: String(SEISMIC_SCALE.S6_STRONG) },
  { label: "震度7", value: String(SEISMIC_SCALE.S7) },
];

const TSUNAMI_AUTO_VALUE = "auto";
const TSUNAMI_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "自動（震度に応じて選択）", value: TSUNAMI_AUTO_VALUE },
  { label: "津波なし", value: "None" },
  { label: "津波注意報", value: "Watch" },
  { label: "津波警報", value: "Warning" },
];

const DEFAULT_SCALE = SEISMIC_SCALE.S5_STRONG;

const SCALE_STEPS: number[] = [
  SEISMIC_SCALE.S1,
  SEISMIC_SCALE.S2,
  SEISMIC_SCALE.S3,
  SEISMIC_SCALE.S4,
  SEISMIC_SCALE.S5_WEAK,
  SEISMIC_SCALE.S5_STRONG,
  SEISMIC_SCALE.S6_WEAK,
  SEISMIC_SCALE.S6_STRONG,
  SEISMIC_SCALE.S7,
];

/** 震源（宮城県沖）を仮定したときの、都道府県ごとのおおよその震度低下量（サンプル分布）。 */
const SAMPLE_STEPS_DOWN: Array<{ pref: string; down: number }> = [
  { pref: "宮城県", down: 0 },
  { pref: "岩手県", down: 1 },
  { pref: "福島県", down: 1 },
  { pref: "山形県", down: 2 },
  { pref: "秋田県", down: 3 },
  { pref: "茨城県", down: 2 },
  { pref: "栃木県", down: 3 },
  { pref: "群馬県", down: 4 },
  { pref: "埼玉県", down: 4 },
  { pref: "千葉県", down: 3 },
  { pref: "東京都", down: 4 },
  { pref: "神奈川県", down: 5 },
  { pref: "新潟県", down: 4 },
  { pref: "青森県", down: 3 },
];

const SAMPLE_MAGNITUDE_BY_MAX_SCALE: Record<number, number> = {
  [SEISMIC_SCALE.S1]: 3.8,
  [SEISMIC_SCALE.S2]: 4.5,
  [SEISMIC_SCALE.S3]: 5.0,
  [SEISMIC_SCALE.S4]: 5.6,
  [SEISMIC_SCALE.S5_WEAK]: 6.0,
  [SEISMIC_SCALE.S5_STRONG]: 6.4,
  [SEISMIC_SCALE.S6_WEAK]: 6.8,
  [SEISMIC_SCALE.S6_STRONG]: 7.2,
  [SEISMIC_SCALE.S7]: 8.0,
};

function scaleAtStepsDown(maxScale: number, stepsDown: number): number {
  const maxIndex = SCALE_STEPS.indexOf(maxScale);
  const baseIndex = maxIndex === -1 ? SCALE_STEPS.length - 1 : maxIndex;
  return SCALE_STEPS[Math.max(0, baseIndex - stepsDown)];
}

function defaultTsunamiStatus(maxScale: number): string {
  if (maxScale >= SEISMIC_SCALE.S5_STRONG) return "Warning";
  if (maxScale >= SEISMIC_SCALE.S4) return "Watch";
  return "None";
}

function buildSampleMessage(maxScale: number, tsunamiStatus: string): JmaQuakeMessage {
  const now = formatJstDateTime(new Date());
  const points = SAMPLE_STEPS_DOWN.map(({ pref, down }) => ({
    pref,
    scale: scaleAtStepsDown(maxScale, down),
  }));

  return {
    code: 551,
    time: now,
    earthquake: {
      time: now,
      hypocenter: {
        name: "宮城県沖（サンプル）",
        latitude: 38.2,
        longitude: 142.3,
        depth: 40,
        magnitude: SAMPLE_MAGNITUDE_BY_MAX_SCALE[maxScale] ?? 5.0,
      },
      maxScale,
      domesticTsunami: tsunamiStatus,
    },
    points,
  };
}

/** 選択中の値を反映したセレクトメニュー・ボタンの行を組み立てる。 */
function buildComponents(
  selectedScale: number,
  selectedTsunami: string,
): [
  ActionRowBuilder<StringSelectMenuBuilder>,
  ActionRowBuilder<StringSelectMenuBuilder>,
  ActionRowBuilder<ButtonBuilder>,
] {
  const scaleMenu = new StringSelectMenuBuilder()
    .setCustomId(SCALE_CUSTOM_ID)
    .setPlaceholder("プレビューする最大震度")
    .addOptions(
      SCALE_OPTIONS.map((option) => ({
        ...option,
        default: option.value === String(selectedScale),
      })),
    );

  const tsunamiMenu = new StringSelectMenuBuilder()
    .setCustomId(TSUNAMI_CUSTOM_ID)
    .setPlaceholder("津波情報")
    .addOptions(
      TSUNAMI_OPTIONS.map((option) => ({
        ...option,
        default: option.value === selectedTsunami,
      })),
    );

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(SUBMIT_CUSTOM_ID)
      .setLabel("この内容でプレビューを投稿")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(CANCEL_CUSTOM_ID).setLabel("キャンセル").setStyle(ButtonStyle.Secondary),
  );

  return [
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(scaleMenu),
    new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(tsunamiMenu),
    buttons,
  ];
}

function selectionSummary(selectedScale: number, selectedTsunami: string): string {
  const scaleLabel = SCALE_OPTIONS.find((o) => o.value === String(selectedScale))?.label ?? "不明";
  const tsunamiLabel =
    selectedTsunami === TSUNAMI_AUTO_VALUE
      ? `自動（震度に応じて「${
          TSUNAMI_OPTIONS.find((o) => o.value === defaultTsunamiStatus(selectedScale))?.label ?? "不明"
        }」を使用）`
      : (TSUNAMI_OPTIONS.find((o) => o.value === selectedTsunami)?.label ?? "不明");

  return [
    "🧪 **地震情報通知プレビュー（テスト用）**",
    "震度・津波情報を選択し、「この内容でプレビューを投稿」を押してください。",
    "",
    `現在の選択: 最大震度 = ${scaleLabel} / 津波情報 = ${tsunamiLabel}`,
  ].join("\n");
}

async function postPreview(
  interaction: ChatInputCommandInteraction,
  maxScale: number,
  tsunamiStatus: string,
): Promise<void> {
  const message = buildSampleMessage(maxScale, tsunamiStatus);
  const prefectureScales = summarizeByPrefecture(message.points);
  const regions = collectAffectedRegions(prefectureScales, config.earthquakeMinScale);

  const infoImage = renderEarthquakeInfoImage(
    message,
    prefectureScales,
    regions,
    config.earthquakeMinScale,
  );
  const mapImage = renderEpicenterMapImage(message.earthquake?.hypocenter, prefectureScales);

  const channel = interaction.channel;
  if (!channel || !channel.isSendable()) {
    throw new Error("プレビューの投稿先チャンネルを取得できませんでした。");
  }

  await channel.send({
    content:
      "🧪 **これはテスト用のプレビューです。実際の地震ではありません。**\nサンプルデータで地震情報通知の見た目を表示しています（メンションは送信されません）。\n\n実際の通知では、この投稿が地震ごとの区切りとなる最初の1通で、続報も同じ形式（震度カード+震源地マップ）で追加投稿されます。",
    files: [
      new AttachmentBuilder(infoImage, { name: "earthquake.png" }),
      new AttachmentBuilder(mapImage, { name: "epicenter.png" }),
    ],
  });
}

export const data = new SlashCommandBuilder()
  .setName("earthquake-preview")
  .setDescription("地震情報通知の見た目をサンプルデータでプレビュー投稿します（テスト用・管理者限定）")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setContexts(InteractionContextType.Guild);

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  let selectedScale: number = DEFAULT_SCALE;
  let selectedTsunami = TSUNAMI_AUTO_VALUE;

  await interaction.reply({
    content: selectionSummary(selectedScale, selectedTsunami),
    components: buildComponents(selectedScale, selectedTsunami),
    flags: MessageFlags.Ephemeral,
  });

  const replyMessage = await interaction.fetchReply();
  const collector = replyMessage.createMessageComponentCollector({
    filter: (component) => component.user.id === interaction.user.id,
    time: SELECT_TIMEOUT_MS,
  });

  const handleComponent = async (component: MessageComponentInteraction): Promise<void> => {
    if (component.customId === SCALE_CUSTOM_ID && component.isStringSelectMenu()) {
      selectedScale = Number(component.values[0]);
      await component.update({
        content: selectionSummary(selectedScale, selectedTsunami),
        components: buildComponents(selectedScale, selectedTsunami),
      });
      return;
    }

    if (component.customId === TSUNAMI_CUSTOM_ID && component.isStringSelectMenu()) {
      selectedTsunami = component.values[0];
      await component.update({
        content: selectionSummary(selectedScale, selectedTsunami),
        components: buildComponents(selectedScale, selectedTsunami),
      });
      return;
    }

    if (component.customId === CANCEL_CUSTOM_ID) {
      await component.update({ content: "キャンセルしました。", components: [] });
      collector.stop("cancelled");
      return;
    }

    if (component.customId === SUBMIT_CUSTOM_ID) {
      await component.deferUpdate();
      const tsunamiStatus =
        selectedTsunami === TSUNAMI_AUTO_VALUE ? defaultTsunamiStatus(selectedScale) : selectedTsunami;

      try {
        await postPreview(interaction, selectedScale, tsunamiStatus);
        await interaction.editReply({ content: "✅ プレビューを投稿しました。", components: [] });
      } catch (error) {
        logger.error("地震情報プレビューの投稿に失敗しました。", error);
        await interaction.editReply({
          content: "❌ プレビューの投稿中にエラーが発生しました。時間をおいて再度お試しください。",
          components: [],
        });
      }
      collector.stop("submitted");
    }
  };

  collector.on("collect", (component) => {
    handleComponent(component).catch((error) => {
      logger.error("地震情報プレビューの操作中にエラーが発生しました。", error);
    });
  });

  collector.on("end", (_collected, reason) => {
    if (reason === "submitted" || reason === "cancelled") return;
    interaction
      .editReply({ content: "⏱️ 選択がタイムアウトしました。もう一度コマンドを実行してください。", components: [] })
      .catch(() => undefined);
  });
}
