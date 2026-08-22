import { Client, Events, GatewayIntentBits, MessageFlags, type Interaction } from "discord.js";
import { COMMANDS_BY_NAME } from "./commands";
import { config } from "./config";
import { installShutdownHandlers, onShutdown } from "./lifecycle";
import { startEarthquakeWatcher } from "./services/earthquake";
import { startAreaMasterRefresh } from "./services/jmaAreaMaster";
import { startJmaWarningWatcher } from "./services/jmaWarnings";
import { logger } from "./utils/logger";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function dispatchInteraction(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    await COMMANDS_BY_NAME.get(interaction.commandName)?.autocomplete?.(interaction);
    return;
  }

  if (interaction.isChatInputCommand()) {
    const command = COMMANDS_BY_NAME.get(interaction.commandName);
    if (!command) {
      logger.warn(`未登録のコマンドを受信しました: ${interaction.commandName}`);
      return;
    }
    await command.execute(interaction);
  }
}

/** 失敗をユーザーに伝える。すでに応答済みの場合は追加送信で伝える。 */
async function replyWithError(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) return;

  const message = { content: "エラーが発生しました。", flags: MessageFlags.Ephemeral } as const;
  const send = interaction.replied || interaction.deferred
    ? interaction.followUp(message)
    : interaction.reply(message);

  await send.catch(() => undefined);
}

client.once(Events.ClientReady, (readyClient) => {
  logger.info(`Discord Bot にログインしました: ${readyClient.user.tag}`);

  startEarthquakeWatcher(client, config.earthquakeMinScale);
  startAreaMasterRefresh();
  startJmaWarningWatcher(client, config.jmaPollingIntervalMinutes);
});

client.on(Events.InteractionCreate, (interaction) => {
  dispatchInteraction(interaction).catch(async (error) => {
    logger.error("インタラクションの処理中にエラーが発生しました。", error);
    await replyWithError(interaction);
  });
});

client.on(Events.Error, (error) => {
  logger.error("Discord クライアントでエラーが発生しました。", error);
});

process.on("unhandledRejection", (reason) => {
  logger.error("未処理の Promise rejection が発生しました。", reason);
});

process.on("uncaughtException", (error) => {
  // 状態が壊れたまま動き続けるより、終了して systemd に再起動させる。
  logger.error("未捕捉の例外が発生しました。プロセスを終了します。", error);
  process.exit(1);
});

installShutdownHandlers();
onShutdown(() => client.destroy());

client.login(config.discord.token).catch((error) => {
  logger.error("Discord へのログインに失敗しました。DISCORD_TOKEN を確認してください。", error);
  process.exit(1);
});
