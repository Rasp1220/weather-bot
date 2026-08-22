import WebSocket from "ws";
import { EmbedBuilder } from "discord.js";
import type { Client } from "discord.js";
import { formatScale, SEISMIC_SCALE } from "../data/earthquakeScale";
import { isShuttingDown, onShutdown } from "../lifecycle";
import { getChannelId } from "./settings";
import { fetchNotificationChannel } from "../utils/discord";
import { logger } from "../utils/logger";
import { MINUTE_MS, SECOND_MS } from "../utils/time";

const P2P_QUAKE_WS_URL = "wss://api.p2pquake.net/v2/ws";
/** P2P地震情報 API における「JMA 震度速報・地震情報」のメッセージ種別。 */
const JMA_QUAKE_CODE = 551;
const RECONNECT_BASE_DELAY_MS = 5 * SECOND_MS;
const RECONNECT_MAX_DELAY_MS = 5 * MINUTE_MS;
/** この震度以上で @everyone を付ける。 */
const EVERYONE_MENTION_MIN_SCALE = SEISMIC_SCALE.S5_WEAK;

interface JmaQuakeHypocenter {
  name?: string;
  latitude?: number;
  longitude?: number;
  depth?: number;
  magnitude?: number;
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

function buildEarthquakeEmbed(message: JmaQuakeMessage): EmbedBuilder {
  const earthquake = message.earthquake;
  const hypocenter = earthquake?.hypocenter;
  const maxScale = earthquake?.maxScale ?? SEISMIC_SCALE.UNKNOWN;

  const magnitude =
    hypocenter?.magnitude != null && hypocenter.magnitude > 0 ? `M${hypocenter.magnitude}` : "不明";
  const depth =
    hypocenter?.depth != null && hypocenter.depth >= 0 ? `約${hypocenter.depth}km` : "不明";

  return new EmbedBuilder()
    .setTitle("🚨 地震情報")
    .setColor(embedColorForScale(maxScale))
    .addFields(
      { name: "最大震度", value: formatScale(maxScale), inline: true },
      { name: "マグニチュード", value: magnitude, inline: true },
      { name: "深さ", value: depth, inline: true },
      { name: "震源地", value: hypocenter?.name || "不明", inline: false },
      { name: "発生時刻", value: earthquake?.time || "不明", inline: false },
      { name: "津波", value: describeTsunami(earthquake?.domesticTsunami), inline: false },
    )
    .setFooter({ text: "情報提供: 気象庁 / P2P地震情報" })
    .setTimestamp(new Date());
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

  const mentionEveryone = maxScale >= EVERYONE_MENTION_MIN_SCALE;
  await channel.send({
    content: mentionEveryone ? "@everyone" : undefined,
    embeds: [buildEarthquakeEmbed(message)],
    allowedMentions: { parse: mentionEveryone ? ["everyone"] : [] },
  });

  logger.info(
    `地震情報を通知しました（最大震度: ${formatScale(maxScale)}${mentionEveryone ? " / @everyone" : ""}）`,
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
