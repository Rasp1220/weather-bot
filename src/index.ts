import { Client, Events, GatewayIntentBits, Interaction } from "discord.js";
import { config } from "./config";
import { logger } from "./utils/logger";
import { startEarthquakeWatcher, stopEarthquakeWatcher } from "./services/earthquake";
import { startAreaMasterRefresh, stopAreaMasterRefresh } from "./services/jmaAreaMaster";
import { startJmaWarningWatcher, stopJmaWarningWatcher } from "./services/jmaWarnings";
import * as weatherCommand from "./commands/weather";
import * as configCommand from "./commands/config";

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, (readyClient) => {
  logger.info(`Discord Bot にログインしました: ${readyClient.user.tag}`);

  startEarthquakeWatcher(client, config.earthquakeMinScale);
  startAreaMasterRefresh();
  startJmaWarningWatcher(client, config.jmaPollingIntervalMinutes);
});

client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === "weather") {
      await weatherCommand.execute(interaction);
      return;
    }
    if (interaction.isAutocomplete() && interaction.commandName === "weather") {
      await weatherCommand.autocomplete(interaction);
      return;
    }
    if (interaction.isChatInputCommand() && interaction.commandName === "config") {
      await configCommand.execute(interaction);
      return;
    }
  } catch (error) {
    logger.error("インタラクションの処理中にエラーが発生しました。", error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: "エラーが発生しました。", ephemeral: true }).catch(() => undefined);
    }
  }
});

process.on("unhandledRejection", (reason) => {
  logger.error("未処理の Promise rejection が発生しました。", reason);
});

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info(`${signal} を受信しました。Botを終了します。`);

  // WebSocket接続やタイマーが残っているとNodeプロセスが自然終了できず、
  // systemd の再起動がタイムアウト（SIGKILL）待ちで固まってしまうため、
  // 後始末をした上で明示的に終了させる。
  stopEarthquakeWatcher();
  stopJmaWarningWatcher();
  stopAreaMasterRefresh();
  client.destroy();

  process.exit(0);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));

client.login(config.discord.token).catch((error) => {
  logger.error("Discord へのログインに失敗しました。DISCORD_TOKEN を確認してください。", error);
  process.exit(1);
});
