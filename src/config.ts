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

/**
 * 数値設定を解決する（環境変数 > config.json > 既定値）。
 * 不正な値をそのまま Number() に通すと NaN が setInterval などに渡り、
 * 原因の分かりにくい不具合になるため、起動時にエラーとして弾く。
 */
function resolveNumber(envName: string, fileValue: unknown, fallback: number): number {
  const rawValue = process.env[envName] || fileValue || fallback;

  const value = Number(rawValue);
  if (!Number.isFinite(value)) {
    throw new Error(`設定値 ${envName} が数値ではありません: ${String(rawValue)}`);
  }
  return value;
}

function loadConfigFile(): RawConfigFile {
  const configPath = path.resolve(process.cwd(), "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`config.json が見つかりません: ${configPath}`);
  }
  return JSON.parse(fs.readFileSync(configPath, "utf-8")) as RawConfigFile;
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
  jmaPollingIntervalMinutes: resolveNumber(
    "JMA_POLLING_INTERVAL_MINUTES",
    fileConfig.jmaPollingIntervalMinutes,
    5,
  ),
  earthquakeMinScale: resolveNumber("EARTHQUAKE_MIN_SCALE", fileConfig.earthquakeMinScale, 40),
};
