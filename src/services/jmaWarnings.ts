import fs from "node:fs";
import path from "node:path";
import { Client, EmbedBuilder, TextChannel } from "discord.js";
import { getCachedOfficeRegionMap, type OfficeRegionInfo } from "./jmaAreaMaster";
import { describeWarningCode, shouldNotify } from "../data/warningCodes";
import { getChannelId, getRegionRoleId } from "./settings";
import type { RegionName } from "../data/prefectures";
import { logger } from "../utils/logger";
import { fetchWithTimeout } from "../utils/fetchWithTimeout";

const WARNING_JSON_URL = (officeCode: string) =>
  `https://www.jma.go.jp/bosai/warning/data/warning/${officeCode}.json`;

// この文字列が status に入っている場合は「発表されていない／解除済み」とみなす。
// 気象庁側の表記ゆれに備え、それ以外の値はすべて「発表中」として扱う。
const INACTIVE_STATUSES = new Set(["発表なし", "解除", ""]);

const STATE_FILE = path.resolve(process.cwd(), "data", "state.json");
const REQUEST_INTERVAL_MS = 300;

interface JmaWarningEntry {
  code: string;
  status: string;
}

interface JmaWarningArea {
  code: string;
  warnings?: JmaWarningEntry[];
}

interface JmaWarningAreaType {
  areas?: JmaWarningArea[];
}

interface JmaWarningResponse {
  areaTypes?: JmaWarningAreaType[];
}

/** areaコード -> 発表中の警報/注意報コード一覧 */
type ActiveCodesByArea = Record<string, string[]>;
/** officeコード -> ActiveCodesByArea */
type WarningState = Record<string, ActiveCodesByArea>;

function loadState(): WarningState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8")) as WarningState;
    }
  } catch (error) {
    logger.warn("警報状態ファイルの読み込みに失敗しました。初期状態から開始します。", error);
  }
  return {};
}

function saveState(state: WarningState): void {
  try {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state), "utf-8");
  } catch (error) {
    logger.warn("警報状態ファイルの保存に失敗しました。", error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let state: WarningState = loadState();

async function fetchOfficeWarnings(officeCode: string): Promise<JmaWarningResponse> {
  const response = await fetchWithTimeout(WARNING_JSON_URL(officeCode));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as JmaWarningResponse;
}

async function announceNewWarnings(
  client: Client,
  channelId: string,
  info: OfficeRegionInfo,
  newCodes: string[],
): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !(channel instanceof TextChannel)) {
    logger.error(`警報通知チャンネル(${channelId})が見つからないか、テキストチャンネルではありません。`);
    return;
  }

  const roleId = getRegionRoleId(info.region as RegionName);
  const mention = roleId ? `<@&${roleId}> ` : "";

  const lines = newCodes.map((code) => {
    const w = describeWarningCode(code);
    const emoji = w.tier === "special" ? "🟣" : w.tier === "warning" ? "🔴" : "🟡";
    return `${emoji} **${w.name}**`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`⚠️ 気象警報・注意報発表（${info.region}地方）`)
    .setColor(0xff5252)
    .setDescription(`**対象地域:** ${info.prefecture}\n\n${lines.join("\n")}`)
    .setFooter({ text: "情報提供: 気象庁" })
    .setTimestamp(new Date());

  await channel.send({
    content: mention || undefined,
    embeds: [embed],
    allowedMentions: { roles: roleId ? [roleId] : [] },
  });

  logger.info(`警報を通知しました: ${info.prefecture} (${info.region}) - ${newCodes.join(", ")}`);
}

async function checkOffice(
  client: Client,
  channelId: string | undefined,
  officeCode: string,
  info: OfficeRegionInfo,
): Promise<void> {
  const data = await fetchOfficeWarnings(officeCode);

  const previousForOffice = state[officeCode] ?? {};
  const nextForOffice: ActiveCodesByArea = {};
  const newlyIssued = new Set<string>();

  for (const areaType of data.areaTypes ?? []) {
    for (const area of areaType.areas ?? []) {
      const activeCodes = (area.warnings ?? [])
        .filter((w) => !INACTIVE_STATUSES.has(w.status))
        .map((w) => w.code)
        .filter((code) => shouldNotify(code));

      nextForOffice[area.code] = activeCodes;

      const previousCodes = new Set(previousForOffice[area.code] ?? []);
      for (const code of activeCodes) {
        if (!previousCodes.has(code)) {
          newlyIssued.add(code);
        }
      }
    }
  }

  state[officeCode] = nextForOffice;

  if (newlyIssued.size > 0) {
    if (channelId) {
      await announceNewWarnings(client, channelId, info, [...newlyIssued]);
    } else {
      logger.warn(
        `警報通知チャンネルが未設定のため通知をスキップしました (${info.prefecture}) 。/config channel set コマンドで設定してください。`,
      );
    }
  }
}

async function pollAll(client: Client): Promise<void> {
  const officeMap = getCachedOfficeRegionMap();
  if (!officeMap || officeMap.size === 0) {
    logger.warn("気象庁エリアマスタが未取得のため、今回の警報チェックをスキップします。");
    return;
  }

  const channelId = getChannelId("warning");

  for (const [officeCode, info] of officeMap) {
    try {
      await checkOffice(client, channelId, officeCode, info);
    } catch (error) {
      logger.error(`警報情報の取得に失敗しました (officeCode=${officeCode})`, error);
    }
    // 気象庁サーバへの短時間集中アクセスを避けるため、リクエスト間隔を空ける。
    await sleep(REQUEST_INTERVAL_MS);
  }

  saveState(state);
}

let warningTimeout: NodeJS.Timeout | null = null;
let warningInterval: NodeJS.Timeout | null = null;

export function startJmaWarningWatcher(client: Client, intervalMinutes: number): void {
  const run = (): void => {
    pollAll(client).catch((error) =>
      logger.error("警報チェックの実行中にエラーが発生しました。", error),
    );
  };

  // エリアマスタの初回取得を少し待ってから最初のチェックを行う。
  warningTimeout = setTimeout(run, 10_000);
  warningInterval = setInterval(run, intervalMinutes * 60_000);
}

export function stopJmaWarningWatcher(): void {
  if (warningTimeout) clearTimeout(warningTimeout);
  if (warningInterval) clearInterval(warningInterval);
}
