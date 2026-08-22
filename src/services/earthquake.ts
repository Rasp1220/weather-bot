import WebSocket from "ws";
import { EmbedBuilder } from "discord.js";
import type { APIEmbedField, Client } from "discord.js";
import { formatScale, SEISMIC_SCALE } from "../data/earthquakeScale";
import { findPrefecture, type RegionName } from "../data/prefectures";
import { isShuttingDown, onShutdown } from "../lifecycle";
import { buildRegionMention, type RegionMention } from "./mentions";
import { getChannelId } from "./settings";
import { fetchNotificationChannel } from "../utils/discord";
import { logger } from "../utils/logger";
import { MINUTE_MS, SECOND_MS } from "../utils/time";

const P2P_QUAKE_WS_URL = "wss://api.p2pquake.net/v2/ws";
/** P2P地震情報 API における「JMA 震度速報・地震情報」のメッセージ種別。 */
const JMA_QUAKE_CODE = 551;
const RECONNECT_BASE_DELAY_MS = 5 * SECOND_MS;
const RECONNECT_MAX_DELAY_MS = 5 * MINUTE_MS;
/** Discord の埋め込みフィールド1つあたりの最大文字数。 */
const MAX_FIELD_LENGTH = 1024;
/** メンション済み地震を覚えておく件数（続報の重複メンション判定用）。 */
const RECENT_EVENT_LIMIT = 50;

interface JmaQuakeHypocenter {
  name?: string;
  latitude?: number;
  longitude?: number;
  depth?: number;
  magnitude?: number;
}

/** 各地の震度観測点（震度速報では市区町村ではなく地域単位で届く）。 */
interface JmaQuakePoint {
  pref?: string;
  addr?: string;
  isArea?: boolean;
  scale?: number;
}

interface JmaQuakeMessage {
  code: number;
  time: string;
  earthquake?: {
    time: string;
    hypocenter?: JmaQuakeHypocenter;
    maxScale?: number;
    domesticTsunami?: string;
  };
  points?: JmaQuakePoint[];
}

function describeTsunami(status: string | undefined): string {
  switch (status) {
    case "None":
      return "この地震による津波の心配はありません。";
    case "Checking":
      return "津波の有無を調査中です。";
    case "NonEffective":
      return "若干の海面変動が予想されますが、被害の心配はありません。";
    case "Watch":
      return "津波注意報が発表されています。";
    case "Warning":
      return "津波警報が発表されています。最新情報にご注意ください。";
    default:
      return "情報なし";
  }
}

function embedColorForScale(maxScale: number): number {
  if (maxScale >= SEISMIC_SCALE.S6_WEAK) return 0xd32f2f;
  if (maxScale >= SEISMIC_SCALE.S5_WEAK) return 0xf57c00;
  return 0xfbc02d;
}

/** 観測点の一覧を「都道府県 -> その都道府県の最大震度」にまとめる。 */
function summarizeByPrefecture(points: JmaQuakePoint[] | undefined): Map<string, number> {
  const byPrefecture = new Map<string, number>();

  for (const point of points ?? []) {
    if (!point.pref) continue;
    const scale = point.scale ?? SEISMIC_SCALE.UNKNOWN;
    const current = byPrefecture.get(point.pref);
    if (current == null || scale > current) byPrefecture.set(point.pref, scale);
  }

  return byPrefecture;
}

/**
 * メンション対象の地方を決める。通知しきい値以上の揺れを観測した都道府県の地方だけを
 * 対象とし、しきい値以上の観測点が1つも取れなかった場合のみ、観測された全都道府県に
 * フォールバックする（対象地方が空になって @here だけになるのを避けるため）。
 */
function collectAffectedRegions(
  prefectureScales: Map<string, number>,
  minScale: number,
): Set<RegionName> {
  const pickRegions = (threshold: number): Set<RegionName> => {
    const regions = new Set<RegionName>();
    for (const [name, scale] of prefectureScales) {
      if (scale < threshold) continue;
      const prefecture = findPrefecture(name);
      if (prefecture) regions.add(prefecture.region);
    }
    return regions;
  };

  const affected = pickRegions(minScale);
  return affected.size > 0 ? affected : pickRegions(SEISMIC_SCALE.UNKNOWN);
}

/** 「震度4: 宮城県、福島県」のように、震度の高い順で観測地域を並べる。 */
function formatObservedAreas(
  prefectureScales: Map<string, number>,
  minScale: number,
): string | undefined {
  const namesByScale = new Map<number, string[]>();

  for (const [name, scale] of prefectureScales) {
    if (scale < minScale) continue;
    const names = namesByScale.get(scale);
    if (names) names.push(name);
    else namesByScale.set(scale, [name]);
  }

  if (namesByScale.size === 0) return undefined;

  const text = [...namesByScale.entries()]
    .sort(([a], [b]) => b - a)
    .map(([scale, names]) => `震度${formatScale(scale)}: ${names.join("、")}`)
    .join("\n");

  return text.length > MAX_FIELD_LENGTH ? `${text.slice(0, MAX_FIELD_LENGTH - 1)}…` : text;
}

function buildEarthquakeEmbed(
  message: JmaQuakeMessage,
  prefectureScales: Map<string, number>,
  regions: Set<RegionName>,
  minScale: number,
): EmbedBuilder {
  const earthquake = message.earthquake;
  const hypocenter = earthquake?.hypocenter;
  const maxScale = earthquake?.maxScale ?? SEISMIC_SCALE.UNKNOWN;

  const magnitude =
    hypocenter?.magnitude != null && hypocenter.magnitude > 0 ? `M${hypocenter.magnitude}` : "不明";
  const depth =
    hypocenter?.depth != null && hypocenter.depth >= 0 ? `約${hypocenter.depth}km` : "不明";

  const fields: APIEmbedField[] = [
    { name: "最大震度", value: formatScale(maxScale), inline: true },
    { name: "マグニチュード", value: magnitude, inline: true },
    { name: "深さ", value: depth, inline: true },
    { name: "震源地", value: hypocenter?.name || "不明", inline: false },
    { name: "発生時刻", value: earthquake?.time || "不明", inline: false },
    { name: "対象地方", value: regions.size > 0 ? [...regions].join("、") : "不明", inline: false },
  ];

  const observedAreas = formatObservedAreas(prefectureScales, minScale);
  if (observedAreas) {
    fields.push({ name: "観測地域", value: observedAreas, inline: false });
  }

  fields.push({ name: "津波", value: describeTsunami(earthquake?.domesticTsunami), inline: false });

  return new EmbedBuilder()
    .setTitle("🚨 地震情報")
    .setColor(embedColorForScale(maxScale))
    .addFields(fields)
    .setFooter({ text: "情報提供: 気象庁 / P2P地震情報" })
    .setTimestamp(new Date());
}

/** メンション済みの地震。同一地震の続報で同じ地方を繰り返しメンションしないために使う。 */
interface NotifiedEvent {
  maxScale: number;
  regions: Set<RegionName>;
}

const recentEvents = new Map<string, NotifiedEvent>();

/** 同一の地震かどうかは発生時刻で判定する（P2P地震情報のメッセージIDは続報ごとに変わるため）。 */
function eventKey(message: JmaQuakeMessage): string | undefined {
  return message.earthquake?.time || message.time || undefined;
}

/**
 * 気象庁は1つの地震について震度速報・震源情報・詳細情報と複数回の続報を出すため、
 * そのたびに同じ地方をメンションすると通知が煩わしくなる。初報・震度が引き上げられた
 * とき・新たな地方が対象に加わったときだけメンションし、それ以外の続報は
 * メンションなし（undefined）で流す。
 */
function resolveMention(
  message: JmaQuakeMessage,
  maxScale: number,
  regions: Set<RegionName>,
): RegionMention | undefined {
  const key = eventKey(message);
  if (!key) return buildRegionMention(regions);

  const previous = recentEvents.get(key);
  const targets =
    !previous || maxScale > previous.maxScale
      ? regions
      : new Set([...regions].filter((region) => !previous.regions.has(region)));

  // 記録し直すことで Map の末尾に移動させ、古い地震から順に捨てられるようにする。
  recentEvents.delete(key);
  recentEvents.set(key, {
    maxScale: previous ? Math.max(maxScale, previous.maxScale) : maxScale,
    regions: new Set([...(previous?.regions ?? []), ...regions]),
  });
  while (recentEvents.size > RECENT_EVENT_LIMIT) {
    const oldest = recentEvents.keys().next();
    if (oldest.done) break;
    recentEvents.delete(oldest.value);
  }

  if (previous && targets.size === 0) return undefined;
  return buildRegionMention(targets);
}

async function handleQuakeMessage(
  client: Client,
  message: JmaQuakeMessage,
  minScale: number,
): Promise<void> {
  if (message.code !== JMA_QUAKE_CODE) return;

  const maxScale = message.earthquake?.maxScale ?? SEISMIC_SCALE.UNKNOWN;
  if (maxScale < minScale) return;

  const channelId = getChannelId("earthquake");
  if (!channelId) {
    logger.warn(
      "地震通知チャンネルが未設定のため通知をスキップしました。/config channel set コマンドで設定してください。",
    );
    return;
  }

  const channel = await fetchNotificationChannel(client, channelId);
  if (!channel) return;

  const prefectureScales = summarizeByPrefecture(message.points);
  const regions = collectAffectedRegions(prefectureScales, minScale);
  const mention = resolveMention(message, maxScale, regions);

  await channel.send({
    content: mention?.content,
    embeds: [buildEarthquakeEmbed(message, prefectureScales, regions, minScale)],
    allowedMentions: mention?.allowedMentions ?? { parse: [], roles: [] },
  });

  logger.info(
    `地震情報を通知しました（最大震度: ${formatScale(maxScale)} / メンション: ${mention?.description ?? "なし（メンション済みの地震の続報）"}）`,
  );
}

export function startEarthquakeWatcher(client: Client, minScale: number): void {
  let reconnectDelay = RECONNECT_BASE_DELAY_MS;
  let socket: WebSocket | undefined;
  let reconnectTimer: NodeJS.Timeout | undefined;

  const connect = (): void => {
    if (isShuttingDown()) return;

    logger.info("P2P地震情報 WebSocket に接続します...");
    const ws = new WebSocket(P2P_QUAKE_WS_URL);
    socket = ws;

    ws.on("open", () => {
      logger.info("P2P地震情報 WebSocket に接続しました。");
      reconnectDelay = RECONNECT_BASE_DELAY_MS;
    });

    ws.on("message", (data) => {
      let message: JmaQuakeMessage;
      try {
        message = JSON.parse(data.toString()) as JmaQuakeMessage;
      } catch (error) {
        logger.error("地震情報メッセージの解析に失敗しました。", error);
        return;
      }
      handleQuakeMessage(client, message, minScale).catch((error) =>
        logger.error("地震情報メッセージの処理中にエラーが発生しました。", error),
      );
    });

    ws.on("close", (code) => {
      if (socket === ws) socket = undefined;
      if (isShuttingDown()) return;

      logger.warn(
        `P2P地震情報 WebSocket が切断されました (code=${code})。${reconnectDelay / SECOND_MS}秒後に再接続します。`,
      );
      reconnectTimer = setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
    });

    ws.on("error", (error) => {
      logger.error("P2P地震情報 WebSocket でエラーが発生しました。", error);
      // close イベントが続けて発火し、そこで再接続がスケジュールされる。
      ws.close();
    });
  };

  // 終了時は再接続を止めて接続を閉じる。放置すると WebSocket と再接続タイマが
  // イベントループに残り、プロセスの停止が遅れる。
  onShutdown(() => {
    clearTimeout(reconnectTimer);
    socket?.terminate();
    socket = undefined;
  });

  connect();
}
