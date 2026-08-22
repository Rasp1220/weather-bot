import WebSocket from "ws";
import { EmbedBuilder, TextChannel } from "discord.js";
import type { Client } from "discord.js";
import { formatScale } from "../data/earthquakeScale";
import { logger } from "../utils/logger";

const P2P_QUAKE_WS_URL = "wss://api.p2pquake.net/v2/ws";
const JMA_QUAKE_CODE = 551;
const RECONNECT_BASE_DELAY_MS = 5_000;
const RECONNECT_MAX_DELAY_MS = 5 * 60_000;

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

function buildEarthquakeEmbed(message: JmaQuakeMessage): EmbedBuilder {
  const eq = message.earthquake;
  const hypocenter = eq?.hypocenter;
  const maxScale = eq?.maxScale ?? -1;

  const tsunamiText = describeTsunami(eq?.domesticTsunami);

  return new EmbedBuilder()
    .setTitle("🚨 地震情報")
    .setColor(maxScale >= 55 ? 0xd32f2f : maxScale >= 45 ? 0xf57c00 : 0xfbc02d)
    .addFields(
      { name: "最大震度", value: formatScale(maxScale), inline: true },
      {
        name: "マグニチュード",
        value: hypocenter?.magnitude != null && hypocenter.magnitude > 0 ? `M${hypocenter.magnitude}` : "不明",
        inline: true,
      },
      {
        name: "深さ",
        value: hypocenter?.depth != null && hypocenter.depth >= 0 ? `約${hypocenter.depth}km` : "不明",
        inline: true,
      },
      { name: "震源地", value: hypocenter?.name || "不明", inline: false },
      { name: "発生時刻", value: eq?.time || "不明", inline: false },
      { name: "津波", value: tsunamiText, inline: false },
    )
    .setFooter({ text: "情報提供: 気象庁 / P2P地震情報" })
    .setTimestamp(new Date());
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

export function startEarthquakeWatcher(client: Client, channelId: string, minScale: number): void {
  let reconnectDelay = RECONNECT_BASE_DELAY_MS;
  let closedByUs = false;

  const connect = (): void => {
    logger.info("P2P地震情報 WebSocket に接続します...");
    const ws = new WebSocket(P2P_QUAKE_WS_URL);

    ws.on("open", () => {
      logger.info("P2P地震情報 WebSocket に接続しました。");
      reconnectDelay = RECONNECT_BASE_DELAY_MS;
    });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString()) as JmaQuakeMessage;
        if (message.code !== JMA_QUAKE_CODE) return;

        const maxScale = message.earthquake?.maxScale ?? -1;
        if (maxScale < minScale) return;

        const channel = await client.channels.fetch(channelId);
        if (!channel || !(channel instanceof TextChannel)) {
          logger.error(`地震通知チャンネル(${channelId})が見つからないか、テキストチャンネルではありません。`);
          return;
        }

        await channel.send({ embeds: [buildEarthquakeEmbed(message)] });
        logger.info(`地震情報を通知しました（最大震度: ${formatScale(maxScale)}）`);
      } catch (error) {
        logger.error("地震情報メッセージの処理中にエラーが発生しました。", error);
      }
    });

    ws.on("close", (code) => {
      if (closedByUs) return;
      logger.warn(`P2P地震情報 WebSocket が切断されました (code=${code})。${reconnectDelay / 1000}秒後に再接続します。`);
      setTimeout(connect, reconnectDelay);
      reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_DELAY_MS);
    });

    ws.on("error", (error) => {
      logger.error("P2P地震情報 WebSocket でエラーが発生しました。", error);
      ws.close();
    });
  };

  connect();

  process.once("SIGTERM", () => {
    closedByUs = true;
  });
  process.once("SIGINT", () => {
    closedByUs = true;
  });
}
