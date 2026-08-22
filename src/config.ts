import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import type { RegionName } from "./data/prefectures";

dotenv.config();

interface RawConfigFile {
  regions: Record<RegionName, string>;
  jmaPollingIntervalMinutes: number;
  earthquakeMinScale: number;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `環境変数 ${name} が設定されていません。.env ファイル（.env.example を参照）を作成してください。`,
    );
  }
  return value;
}

function loadConfigFile(): RawConfigFile {
  const configPath = path.resolve(process.cwd(), "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`config.json が見つかりません: ${configPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(configPath, "utf-8")) as RawConfigFile;
  return raw;
}

const fileConfig = loadConfigFile();

export const config = {
  discord: {
    token: requireEnv("DISCORD_TOKEN"),
    clientId: requireEnv("DISCORD_CLIENT_ID"),
    guildId: process.env.DISCORD_GUILD_ID || undefined,
  },
  channels: {
    // 未設定でも起動可能。/config channel set コマンドで実行時に設定できる。
    earthquake: process.env.EARTHQUAKE_CHANNEL_ID || undefined,
    warning: process.env.WARNING_CHANNEL_ID || undefined,
  },
  regionRoleIds: fileConfig.regions,
  jmaPollingIntervalMinutes: Number(
    process.env.JMA_POLLING_INTERVAL_MINUTES || fileConfig.jmaPollingIntervalMinutes || 5,
  ),
  earthquakeMinScale: Number(
    process.env.EARTHQUAKE_MIN_SCALE || fileConfig.earthquakeMinScale || 30,
  ),
};
