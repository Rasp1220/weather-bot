import { REST, Routes } from "discord.js";
import { config } from "../config";
import { data as weatherCommand } from "./weather";
import { data as configCommand } from "./config";
import { logger } from "../utils/logger";

async function main(): Promise<void> {
  const commands = [weatherCommand.toJSON(), configCommand.toJSON()];
  const rest = new REST().setToken(config.discord.token);

  const route = config.discord.guildId
    ? Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId)
    : Routes.applicationCommands(config.discord.clientId);

  logger.info(
    config.discord.guildId
      ? `ギルド(${config.discord.guildId})にスラッシュコマンドを登録します...`
      : "グローバルスラッシュコマンドを登録します（反映まで最大1時間程度かかる場合があります）...",
  );

  await rest.put(route, { body: commands });
  logger.info("スラッシュコマンドの登録が完了しました。");
}

main().catch((error) => {
  logger.error("スラッシュコマンドの登録に失敗しました。", error);
  process.exit(1);
});
