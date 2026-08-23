import {
  AttachmentBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
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

/**
 * 本物の地震を待たずに通知の見た目を確認するためのテストコマンド。
 * サンプルデータのみを使い、実際のメンションは飛ばさない。
 */

const SCALE_CHOICES = [
  { name: "震度1", value: String(SEISMIC_SCALE.S1) },
  { name: "震度2", value: String(SEISMIC_SCALE.S2) },
  { name: "震度3", value: String(SEISMIC_SCALE.S3) },
  { name: "震度4", value: String(SEISMIC_SCALE.S4) },
  { name: "震度5弱", value: String(SEISMIC_SCALE.S5_WEAK) },
  { name: "震度5強", value: String(SEISMIC_SCALE.S5_STRONG) },
  { name: "震度6弱", value: String(SEISMIC_SCALE.S6_WEAK) },
  { name: "震度6強", value: String(SEISMIC_SCALE.S6_STRONG) },
  { name: "震度7", value: String(SEISMIC_SCALE.S7) },
];

const TSUNAMI_CHOICES = [
  { name: "なし", value: "None" },
  { name: "注意報", value: "Watch" },
  { name: "警報", value: "Warning" },
];

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

export const data = new SlashCommandBuilder()
  .setName("earthquake-preview")
  .setDescription("地震情報通知の見た目をサンプルデータでプレビュー投稿します（テスト用・管理者限定）")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addStringOption((option) =>
    option
      .setName("scale")
      .setDescription("プレビューする最大震度（未指定は震度5強）")
      .addChoices(...SCALE_CHOICES),
  )
  .addStringOption((option) =>
    option
      .setName("tsunami")
      .setDescription("津波情報（未指定は震度に応じて自動選択）")
      .addChoices(...TSUNAMI_CHOICES),
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const scaleOption = interaction.options.getString("scale");
  const maxScale = scaleOption ? Number(scaleOption) : SEISMIC_SCALE.S5_STRONG;
  const tsunamiStatus = interaction.options.getString("tsunami") ?? defaultTsunamiStatus(maxScale);

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

  await interaction.reply({
    content:
      "🧪 **これはテスト用のプレビューです。実際の地震ではありません。**\nサンプルデータで地震情報通知の見た目を表示しています（メンションは送信されません）。",
    files: [
      new AttachmentBuilder(infoImage, { name: "earthquake.png" }),
      new AttachmentBuilder(mapImage, { name: "epicenter.png" }),
    ],
  });
}
