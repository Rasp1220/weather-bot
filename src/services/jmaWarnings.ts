import { EmbedBuilder } from "discord.js";
import type { Client } from "discord.js";
import { getCachedOfficeRegionMap, type OfficeRegionInfo } from "./jmaAreaMaster";
import { describeWarningCode, shouldNotify, type WarningCodeInfo } from "../data/warningCodes";
import { isShuttingDown, scheduleInterval, scheduleTimeout, shutdownSignal } from "../lifecycle";
import { buildRegionMention } from "./mentions";
import { getChannelId } from "./settings";
import { fetchNotificationChannel } from "../utils/discord";
import { fetchJson } from "../utils/http";
import { dataFilePath, readJsonFile, writeJsonFile } from "../utils/jsonStore";
import { logger } from "../utils/logger";
import { MINUTE_MS, SECOND_MS, sleep } from "../utils/time";

const warningJsonUrl = (officeCode: string): string =>
  `https://www.jma.go.jp/bosai/warning/data/warning/${officeCode}.json`;

// この文字列が status に入っている場合は「発表されていない／解除済み」とみなす。
// 「発表警報・注意報はなし」は警報が一つも発表されていないエリアで status のみ
// 返され code は付与されない（気象庁APIの実際の仕様）。気象庁側の表記ゆれに備え、
// それ以外の値はすべて「発表中」として扱う。
const INACTIVE_STATUSES = new Set(["発表警報・注意報はなし", "解除", ""]);

const STATE_FILE = dataFilePath("state.json");
const STATE_DESCRIPTION = "警報状態ファイル(data/state.json)";
/** 気象庁サーバへの短時間集中アクセスを避けるためのリクエスト間隔。 */
const REQUEST_INTERVAL_MS = 300;
/** エリアマスタの初回取得を待ってから最初のチェックを行うまでの猶予。 */
const INITIAL_DELAY_MS = 10 * SECOND_MS;

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

const state: WarningState = readJsonFile<WarningState>(STATE_FILE, STATE_DESCRIPTION) ?? {};

function fetchOfficeWarnings(officeCode: string): Promise<JmaWarningResponse> {
  return fetchJson<JmaWarningResponse>(warningJsonUrl(officeCode), { signal: shutdownSignal });
}

/** レスポンスに含まれる全エリアの警報エントリを平坦化して列挙する。 */
function* iterateAreas(
  data: JmaWarningResponse,
): Generator<{ areaCode: string; warnings: JmaWarningEntry[] }> {
  for (const areaType of data.areaTypes ?? []) {
    for (const area of areaType.areas ?? []) {
      yield { areaCode: area.code, warnings: area.warnings ?? [] };
    }
  }
}

function isActive(warning: JmaWarningEntry): boolean {
  return Boolean(warning.code) && !INACTIVE_STATUSES.has(warning.status);
}

const WARNING_TIER_ORDER: Record<WarningCodeInfo["tier"], number> = {
  special: 0,
  warning: 1,
  advisory: 2,
};

/**
 * 指定した予報区（office）で現在発表中の警報・注意報を、重複を除いて重要度順に返す。
 * `/weather` コマンドでの現況表示用（発表状況の差分検知は行わない）。
 */
export async function fetchActiveWarnings(officeCode: string): Promise<WarningCodeInfo[]> {
  const data = await fetchOfficeWarnings(officeCode);

  const activeByCode = new Map<string, WarningCodeInfo>();
  for (const { warnings } of iterateAreas(data)) {
    for (const warning of warnings) {
      if (!isActive(warning)) continue;
      if (!activeByCode.has(warning.code)) {
        activeByCode.set(warning.code, describeWarningCode(warning.code));
      }
    }
  }

  return [...activeByCode.values()].sort(
    (a, b) => WARNING_TIER_ORDER[a.tier] - WARNING_TIER_ORDER[b.tier],
  );
}

async function announceNewWarnings(
  client: Client,
  channelId: string,
  info: OfficeRegionInfo,
  newCodes: string[],
): Promise<void> {
  const channel = await fetchNotificationChannel(client, channelId);
  if (!channel) return;

  const warnings = newCodes.map((code) => describeWarningCode(code));
  const lines = warnings.map((warning) => {
    const emoji =
      warning.tier === "special" ? "🟣" : warning.tier === "warning" ? "🔴" : "🟡";
    return `${emoji} **${warning.name}**`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`⚠️ 気象警報・注意報発表（${info.region}地方）`)
    .setColor(0xff5252)
    .setDescription(`**対象地域:** ${info.prefecture}\n\n${lines.join("\n")}`)
    .setFooter({ text: "情報提供: 気象庁" })
    .setTimestamp(new Date());

  // 注意報のみの場合はメンションを付けない。警報・特別警報が1つでも含まれる場合のみ通知対象とする。
  const hasWarningOrAbove = warnings.some((warning) => warning.tier !== "advisory");
  const mention = hasWarningOrAbove ? buildRegionMention([info.region]) : undefined;

  await channel.send({
    content: mention?.content ?? "",
    embeds: [embed],
    allowedMentions: mention?.allowedMentions ?? { parse: [], roles: [] },
  });

  logger.info(
    `警報を通知しました: ${info.prefecture} (${info.region}) - ${newCodes.join(", ")} / メンション: ${mention?.description ?? "なし（注意報のみ）"}`,
  );
}

/**
 * 1予報区分の発表状況を取得し、前回から新たに発表された警報だけを通知する。
 * 発表状況に変化があった場合は true を返す（呼び出し側で状態ファイルの保存要否を判断する）。
 */
async function checkOffice(
  client: Client,
  channelId: string | undefined,
  officeCode: string,
  info: OfficeRegionInfo,
): Promise<boolean> {
  const data = await fetchOfficeWarnings(officeCode);

  const previousForOffice = state[officeCode] ?? {};
  const nextForOffice: ActiveCodesByArea = {};
  const newlyIssued = new Set<string>();
  let changed = false;

  for (const { areaCode, warnings } of iterateAreas(data)) {
    const activeCodes = warnings
      .filter(isActive)
      .map((warning) => warning.code)
      .filter(shouldNotify);

    nextForOffice[areaCode] = activeCodes;

    const previousCodes = previousForOffice[areaCode] ?? [];
    if (activeCodes.length !== previousCodes.length) changed = true;

    const previousCodeSet = new Set(previousCodes);
    for (const code of activeCodes) {
      if (!previousCodeSet.has(code)) {
        newlyIssued.add(code);
        changed = true;
      }
    }
  }

  // 予報区の構成変更などでエリアそのものが増減した場合も保存対象とする。
  if (Object.keys(nextForOffice).length !== Object.keys(previousForOffice).length) changed = true;

  if (newlyIssued.size > 0) {
    if (channelId) {
      // 通知の送信に失敗した場合はここで例外が投げられ、下の状態保存が実行されない。
      // 先に状態を保存してしまうと、送信に失敗した警報も「通知済み」として扱われ、
      // 次回以降のポーリングで再送されなくなってしまうため、送信成功を確認してから保存する。
      await announceNewWarnings(client, channelId, info, [...newlyIssued]);
    } else {
      logger.warn(
        `警報通知チャンネルが未設定のため通知をスキップしました (${info.prefecture}) 。/config channel set コマンドで設定してください。`,
      );
    }
  }

  state[officeCode] = nextForOffice;

  return changed;
}

async function pollAll(client: Client): Promise<void> {
  const officeMap = getCachedOfficeRegionMap();
  if (!officeMap || officeMap.size === 0) {
    logger.warn("気象庁エリアマスタが未取得のため、今回の警報チェックをスキップします。");
    return;
  }

  const channelId = getChannelId("warning");
  let changed = false;

  for (const [officeCode, info] of officeMap) {
    if (isShuttingDown()) break;

    try {
      changed = (await checkOffice(client, channelId, officeCode, info)) || changed;
    } catch (error) {
      if (isShuttingDown()) break;
      logger.error(`警報情報の取得に失敗しました (officeCode=${officeCode})`, error);
    }

    // 終了処理が始まった場合は待機を打ち切り、残りの予報区の巡回も止める。
    if (!(await sleep(REQUEST_INTERVAL_MS, shutdownSignal))) break;
  }

  // 発表状況に変化が無いときは全予報区分を書き戻す必要がない。
  if (changed) {
    writeJsonFile(STATE_FILE, state, STATE_DESCRIPTION, false);
  }
}

export function startJmaWarningWatcher(client: Client, intervalMinutes: number): void {
  let running = false;

  const run = (): void => {
    // 予報区の巡回には数十秒かかるため、前回の巡回が終わる前に次を始めない。
    if (running || isShuttingDown()) return;
    running = true;

    pollAll(client)
      .catch((error) => logger.error("警報チェックの実行中にエラーが発生しました。", error))
      .finally(() => {
        running = false;
      });
  };

  scheduleTimeout(run, INITIAL_DELAY_MS);
  scheduleInterval(run, intervalMinutes * MINUTE_MS);
}
