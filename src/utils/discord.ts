import type { Client, SendableChannels } from "discord.js";
import { logger } from "./logger";

/**
 * 通知先チャンネルを取得する。取得できない場合は理由をログに出して undefined を返す
 * （通知の失敗でポーリング全体を止めないため、例外は投げない）。
 *
 * テキストチャンネルだけでなくアナウンスチャンネルも通知先として選べるため、
 * 具体的なクラスではなく「送信可能かどうか」で判定する。
 */
export async function fetchNotificationChannel(
  client: Client,
  channelId: string,
): Promise<SendableChannels | undefined> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel) {
      logger.error(`通知チャンネル(${channelId})が見つかりません。`);
      return undefined;
    }
    if (!channel.isSendable()) {
      logger.error(`通知チャンネル(${channelId})にはメッセージを送信できません。`);
      return undefined;
    }
    return channel;
  } catch (error) {
    logger.error(`通知チャンネル(${channelId})の取得に失敗しました。`, error);
    return undefined;
  }
}
