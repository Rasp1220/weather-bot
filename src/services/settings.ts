import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { PREFECTURES, type RegionName } from "../data/prefectures";
import { logger } from "../utils/logger";

/**
 * `/config` コマンドで変更可能な実行時設定（通知先チャンネル・地方ロール紐付け）の永続化ストア。
 * 初回起動時は config.json / 環境変数の値を初期値として読み込み、以後は
 * data/settings.json への変更を優先する（コマンドでの変更を再起動後も保持するため）。
 */

const SETTINGS_FILE = path.resolve(process.cwd(), "data", "settings.json");

export type NotificationTarget = "earthquake" | "warning";

export const REGION_NAMES: RegionName[] = Array.from(new Set(PREFECTURES.map((p) => p.region)));

interface SettingsData {
  channels: Partial<Record<NotificationTarget, string>>;
  regionRoleIds: Partial<Record<RegionName, string>>;
}

function defaultSettings(): SettingsData {
  return {
    channels: {
      earthquake: config.channels.earthquake,
      warning: config.channels.warning,
    },
    regionRoleIds: { ...config.regionRoleIds },
  };
}

function loadSettings(): SettingsData {
  const defaults = defaultSettings();
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, "utf-8")) as Partial<SettingsData>;
      return {
        channels: { ...defaults.channels, ...raw.channels },
        regionRoleIds: { ...defaults.regionRoleIds, ...raw.regionRoleIds },
      };
    }
  } catch (error) {
    logger.warn("設定ファイル(data/settings.json)の読み込みに失敗しました。デフォルト値から開始します。", error);
  }
  return defaults;
}

let settings: SettingsData = loadSettings();

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (error) {
    logger.error("設定ファイル(data/settings.json)の保存に失敗しました。", error);
  }
}

export function getChannelId(target: NotificationTarget): string | undefined {
  return settings.channels[target] || undefined;
}

export function setChannelId(target: NotificationTarget, channelId: string): void {
  settings.channels[target] = channelId;
  persist();
}

export function getAllChannelIds(): Partial<Record<NotificationTarget, string>> {
  return { ...settings.channels };
}

export function getRegionRoleId(region: RegionName): string | undefined {
  return settings.regionRoleIds[region] || undefined;
}

export function setRegionRoleId(region: RegionName, roleId: string | null): void {
  settings.regionRoleIds[region] = roleId ?? "";
  persist();
}

export function getAllRegionRoleIds(): Partial<Record<RegionName, string>> {
  return { ...settings.regionRoleIds };
}
