import { REST, Routes } from "discord.js";
import { COMMANDS } from ".";
import { config } from "../config";
import { logger } from "../utils/logger";

async function main(): Promise<void> {
  const rest = new REST().setToken(config.discord.token);
  const { clientId, guildId } = config.discord;

  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  logger.info(
    guildId
      ? `ギルド(${guildId})にスラッシュコマンドを登録します...`
      : "グローバルスラッシュコマンドを登録します（反映まで最大1時間程度かかる場合があります）...",
  );

  await rest.put(route, { body: COMMANDS.map((command) => command.data.toJSON()) });
  logger.info(`スラッシュコマンドの登録が完了しました（${COMMANDS.length}件）。`);
}

main().catch((error) => {
  logger.error("スラッシュコマンドの登録に失敗しました。", error);
  process.exit(1);
});
