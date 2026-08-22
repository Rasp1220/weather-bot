import { config } from "../config";
import { PREFECTURES, type RegionName } from "../data/prefectures";
import { dataFilePath, readJsonFile, writeJsonFile } from "../utils/jsonStore";

/**
 * `/config` コマンドで変更可能な実行時設定（通知先チャンネル・地方ロール紐付け）の永続化ストア。
 * 初回起動時は config.json / 環境変数の値を初期値として読み込み、以後は
 * data/settings.json への変更を優先する（コマンドでの変更を再起動後も保持するため）。
 */

const SETTINGS_FILE = dataFilePath("settings.json");
const SETTINGS_DESCRIPTION = "設定ファイル(data/settings.json)";

export type NotificationTarget = "earthquake" | "warning";

export const REGION_NAMES: RegionName[] = Array.from(new Set(PREFECTURES.map((p) => p.region)));

interface SettingsData {
  channels: Partial<Record<NotificationTarget, string>>;
  regionRoleIds: Partial<Record<RegionName, string>>;
}

function loadSettings(): SettingsData {
  const defaults: SettingsData = {
    channels: {
      earthquake: config.channels.earthquake,
      warning: config.channels.warning,
    },
    regionRoleIds: { ...config.regionRoleIds },
  };

  const stored = readJsonFile<Partial<SettingsData>>(SETTINGS_FILE, SETTINGS_DESCRIPTION);
  if (!stored) return defaults;

  return {
    channels: { ...defaults.channels, ...stored.channels },
    regionRoleIds: { ...defaults.regionRoleIds, ...stored.regionRoleIds },
  };
}

const settings: SettingsData = loadSettings();

function persist(): void {
  writeJsonFile(SETTINGS_FILE, settings, SETTINGS_DESCRIPTION);
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
