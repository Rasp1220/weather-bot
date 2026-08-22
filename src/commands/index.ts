import type {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from "discord.js";
import * as weather from "./weather";
import * as configCommand from "./config";

/**
 * スラッシュコマンドの一覧。
 * 起動時のディスパッチ（index.ts）と Discord への登録（deploy-commands.ts）が
 * それぞれ別々にコマンドを列挙していると追加漏れが起きるため、ここに集約する。
 */

export interface Command {
  data: {
    readonly name: string;
    toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
  };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
  autocomplete?(interaction: AutocompleteInteraction): Promise<void>;
}

export const COMMANDS: Command[] = [weather, configCommand];

export const COMMANDS_BY_NAME: ReadonlyMap<string, Command> = new Map(
  COMMANDS.map((command) => [command.data.name, command]),
);
