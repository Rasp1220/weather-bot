import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import { formatScale, scaleColor, SEISMIC_SCALE } from "../data/earthquakeScale";
import { JAPAN_PREFECTURE_POLYGONS } from "../data/japanMap";
import type { RegionName } from "../data/prefectures";
import { ensureFontsRegistered, FONT_FAMILY } from "../utils/fonts";
import {
  describeTsunami,
  groupObservedAreas,
  type JmaQuakeHypocenter,
  type JmaQuakeMessage,
} from "./earthquake";

ensureFontsRegistered();

function font(size: number, bold = false): string {
  return `${bold ? "bold " : ""}${size}px "${FONT_FAMILY}"`;
}

function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

/** 背景色に対して読みやすい文字色（白 or 黒）を返す。 */
function readableTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? "#212121" : "#ffffff";
}

/** 長い文字列を指定幅で複数行に折り返す。 */
function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let current = "";
  for (const char of text) {
    const next = current + char;
    if (current && ctx.measureText(next).width > maxWidth) {
      lines.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// ---------------------------------------------------------------------------
// 地震情報カード
// ---------------------------------------------------------------------------

const CARD_WIDTH = 760;
const PADDING = 32;
const HEADER_HEIGHT = 172;
const ROW_HEIGHT = 62;
const VALUE_LINE_HEIGHT = 26;
const OBSERVED_LINE_HEIGHT = 30;
const FOOTER_HEIGHT = 46;

/** ラベル/値の行の高さ。値が折り返された場合は行数に応じて高くする。 */
function infoRowHeight(lineCount: number): number {
  return Math.max(ROW_HEIGHT, 36 + lineCount * VALUE_LINE_HEIGHT);
}

function headerGradientColors(maxScale: number): [string, string] {
  if (maxScale >= SEISMIC_SCALE.S6_WEAK) return ["#c62828", "#8e0000"];
  if (maxScale >= SEISMIC_SCALE.S5_WEAK) return ["#f4511e", "#bf360c"];
  return ["#546e7a", "#37474f"];
}

function drawInfoHeader(
  ctx: SKRSContext2D,
  maxScale: number,
  hypocenterName: string,
  occurredAt: string,
): void {
  const [from, to] = headerGradientColors(maxScale);
  const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, HEADER_HEIGHT);
  gradient.addColorStop(0, from);
  gradient.addColorStop(1, to);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_WIDTH, HEADER_HEIGHT);

  drawWarningTriangleIcon(ctx, PADDING + 15, 34, 18);

  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = font(32, true);
  ctx.fillText("地震情報", PADDING + 40, 52);

  ctx.font = font(22);
  ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
  const name = hypocenterName || "不明";
  const nameLines = wrapText(ctx, `震源地: ${name}`, CARD_WIDTH - PADDING * 2 - 190);
  nameLines.slice(0, 2).forEach((line, index) => {
    ctx.fillText(line, PADDING, 90 + index * 28);
  });

  ctx.font = font(16);
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.fillText(`発生時刻: ${occurredAt || "不明"}`, PADDING, HEADER_HEIGHT - 20);

  // 右側に大きな震度バッジを表示する。
  const badgeColor = scaleColor(maxScale);
  const badgeCenterX = CARD_WIDTH - PADDING - 78;
  const badgeCenterY = HEADER_HEIGHT / 2;
  ctx.fillStyle = "rgba(255, 255, 255, 0.15)";
  ctx.beginPath();
  ctx.arc(badgeCenterX, badgeCenterY, 74, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = badgeColor;
  ctx.beginPath();
  ctx.arc(badgeCenterX, badgeCenterY, 62, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = readableTextColor(badgeColor);
  ctx.textAlign = "center";
  ctx.font = font(15, true);
  ctx.fillText("最大震度", badgeCenterX, badgeCenterY - 18);
  ctx.font = font(40, true);
  ctx.fillText(formatScale(maxScale), badgeCenterX, badgeCenterY + 26);
  ctx.textAlign = "left";
}

function drawInfoRow(
  ctx: SKRSContext2D,
  label: string,
  value: string,
  top: number,
  striped: boolean,
  valueColor = "#263238",
): number {
  const VALUE_X = PADDING + 170;
  ctx.font = font(22, true);
  const lines = wrapText(ctx, value, CARD_WIDTH - VALUE_X - PADDING);
  const rowHeight = infoRowHeight(lines.length);

  if (striped) {
    ctx.fillStyle = "rgba(96, 125, 139, 0.08)";
    ctx.fillRect(0, top, CARD_WIDTH, rowHeight);
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "#78909c";
  ctx.font = font(18, true);
  ctx.fillText(label, PADDING, top + 34);

  ctx.fillStyle = valueColor;
  ctx.font = font(22, true);
  const firstLineY = lines.length > 1 ? top + 34 : top + ROW_HEIGHT / 2 + 7;
  lines.forEach((line, index) => {
    ctx.fillText(line, VALUE_X, firstLineY + index * VALUE_LINE_HEIGHT);
  });

  return rowHeight;
}

function drawObservedSection(
  ctx: SKRSContext2D,
  groups: { scale: number; names: string[] }[],
  top: number,
): number {
  if (groups.length === 0) return top;

  const wrapWidth = CARD_WIDTH - PADDING * 2 - 130;
  ctx.font = font(19);
  const lineSets = groups.map((group) => ({
    scale: group.scale,
    lines: wrapText(ctx, group.names.join("、"), wrapWidth),
  }));
  const totalLines = lineSets.reduce((sum, g) => sum + g.lines.length, 0);
  const sectionHeight = 40 + totalLines * OBSERVED_LINE_HEIGHT + 12;

  ctx.fillStyle = "rgba(96, 125, 139, 0.08)";
  ctx.fillRect(0, top, CARD_WIDTH, sectionHeight);

  ctx.textAlign = "left";
  ctx.fillStyle = "#78909c";
  ctx.font = font(18, true);
  ctx.fillText("観測地域", PADDING, top + 30);

  let lineY = top + 30;
  ctx.font = font(19);
  for (const { scale, lines } of lineSets) {
    lines.forEach((line, index) => {
      lineY += OBSERVED_LINE_HEIGHT;
      const dotColor = scaleColor(scale);
      ctx.fillStyle = dotColor;
      ctx.beginPath();
      ctx.arc(PADDING + 138, lineY - 6, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#37474f";
      const prefix = index === 0 ? `震度${formatScale(scale)}: ` : "";
      ctx.fillText(prefix + line, PADDING + 152, lineY);
    });
  }

  return top + sectionHeight;
}

function drawInfoFooter(ctx: SKRSContext2D, top: number): void {
  ctx.strokeStyle = "#cfd8dc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, top + 8);
  ctx.lineTo(CARD_WIDTH - PADDING, top + 8);
  ctx.stroke();

  ctx.fillStyle = "#78909c";
  ctx.font = font(14);
  ctx.fillText("情報提供: 気象庁 / P2P地震情報", PADDING, top + 32);
}

function tsunamiColor(status: string | undefined): string {
  if (status === "Warning") return "#c62828";
  if (status === "Watch") return "#ef6c00";
  return "#37474f";
}

export function renderEarthquakeInfoImage(
  message: JmaQuakeMessage,
  prefectureScales: Map<string, number>,
  regions: Set<RegionName>,
  minScale: number,
): Buffer {
  const earthquake = message.earthquake;
  const hypocenter = earthquake?.hypocenter;
  const maxScale = earthquake?.maxScale ?? SEISMIC_SCALE.UNKNOWN;

  const magnitude =
    hypocenter?.magnitude != null && hypocenter.magnitude > 0 ? `M${hypocenter.magnitude}` : "不明";
  const depth =
    hypocenter?.depth != null && hypocenter.depth >= 0 ? `約${hypocenter.depth}km` : "不明";
  const regionsText = regions.size > 0 ? [...regions].join("、") : "不明";
  const observedGroups = groupObservedAreas(prefectureScales, minScale);
  const tsunamiText = describeTsunami(earthquake?.domesticTsunami);

  // 高さを事前に見積もるため、まず計測用の一時キャンバスで折り返し行数を数える。
  const measureCanvas = createCanvas(CARD_WIDTH, 10);
  const measureCtx = measureCanvas.getContext("2d");

  const valueMaxWidth = CARD_WIDTH - (PADDING + 170) - PADDING;
  measureCtx.font = font(22, true);
  const measureRowHeight = (value: string): number =>
    infoRowHeight(wrapText(measureCtx, value, valueMaxWidth).length);

  const observedWrapWidth = CARD_WIDTH - PADDING * 2 - 130;
  measureCtx.font = font(19);
  const observedLineCount = observedGroups.reduce(
    (sum, group) => sum + wrapText(measureCtx, group.names.join("、"), observedWrapWidth).length,
    0,
  );
  const observedSectionHeight =
    observedGroups.length > 0 ? 40 + observedLineCount * OBSERVED_LINE_HEIGHT + 12 : 0;

  const rowsHeight =
    measureRowHeight(magnitude) +
    measureRowHeight(depth) +
    measureRowHeight(regionsText) +
    measureRowHeight(tsunamiText);
  const height = HEADER_HEIGHT + rowsHeight + observedSectionHeight + FOOTER_HEIGHT + PADDING;

  const canvas = createCanvas(CARD_WIDTH, height);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CARD_WIDTH, height);

  drawInfoHeader(ctx, maxScale, hypocenter?.name || "不明", earthquake?.time || "不明");

  let rowY = HEADER_HEIGHT;
  rowY += drawInfoRow(ctx, "マグニチュード", magnitude, rowY, false);
  rowY += drawInfoRow(ctx, "深さ", depth, rowY, true);
  rowY += drawInfoRow(ctx, "対象地方", regionsText, rowY, false);

  rowY = drawObservedSection(ctx, observedGroups, rowY);

  rowY += drawInfoRow(ctx, "津波", tsunamiText, rowY, true, tsunamiColor(earthquake?.domesticTsunami));

  drawInfoFooter(ctx, rowY);

  return canvas.toBuffer("image/png");
}

// ---------------------------------------------------------------------------
// 震源地マップ
// ---------------------------------------------------------------------------

const MAP_CARD_WIDTH = 640;
const MAP_PADDING = 24;
const MAP_HEADER_HEIGHT = 96;
const MAP_LEGEND_HEIGHT = 64;
const MAP_FOOTER_HEIGHT = 40;

// 日本およびその周辺で発生する地震をおおむね収める緯度経度の範囲。
const LON_MIN = 122;
const LON_MAX = 154;
const LAT_MIN = 20;
const LAT_MAX = 46.5;

const OCEAN_COLOR = "#0d2b45";
const GRATICULE_COLOR = "rgba(255, 255, 255, 0.12)";
const LAND_DEFAULT_COLOR = "#37474f";
const LAND_STROKE_COLOR = "rgba(255, 255, 255, 0.35)";

interface MapProjection {
  mapLeft: number;
  mapTop: number;
  mapWidth: number;
  mapHeight: number;
  project(lon: number, lat: number): [number, number];
}

function buildProjection(areaWidth: number, areaHeight: number, areaTop: number): MapProjection {
  const lonRange = LON_MAX - LON_MIN;
  const latRange = LAT_MAX - LAT_MIN;
  const scale = Math.min(areaWidth / lonRange, areaHeight / latRange);
  const mapWidth = lonRange * scale;
  const mapHeight = latRange * scale;
  const mapLeft = MAP_PADDING + (areaWidth - mapWidth) / 2;
  const mapTop = areaTop + (areaHeight - mapHeight) / 2;

  return {
    mapLeft,
    mapTop,
    mapWidth,
    mapHeight,
    project(lon: number, lat: number): [number, number] {
      const x = mapLeft + (lon - LON_MIN) * scale;
      const y = mapTop + (LAT_MAX - lat) * scale;
      return [x, y];
    },
  };
}

function drawMapHeader(ctx: SKRSContext2D, hypocenter: JmaQuakeHypocenter | undefined): void {
  const gradient = ctx.createLinearGradient(0, 0, MAP_CARD_WIDTH, MAP_HEADER_HEIGHT);
  gradient.addColorStop(0, "#26547c");
  gradient.addColorStop(1, "#1b3a5c");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, MAP_CARD_WIDTH, MAP_HEADER_HEIGHT);

  drawPinIcon(ctx, MAP_PADDING + 12, 34, 16);

  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = font(28, true);
  ctx.fillText("震源地", MAP_PADDING + 32, 44);

  ctx.font = font(17);
  ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
  const name = hypocenter?.name || "不明";
  const lat = hypocenter?.latitude;
  const lon = hypocenter?.longitude;
  const coordText = lat != null && lon != null ? `（北緯${lat.toFixed(1)}° 東経${lon.toFixed(1)}°）` : "";
  ctx.fillText(`${name}${coordText}`, MAP_PADDING, 76);
}

function drawGraticule(ctx: SKRSContext2D, projection: MapProjection): void {
  ctx.strokeStyle = GRATICULE_COLOR;
  ctx.lineWidth = 1;
  ctx.font = font(11);
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";

  for (let lon = Math.ceil(LON_MIN / 5) * 5; lon < LON_MAX; lon += 5) {
    const [x1, y1] = projection.project(lon, LAT_MIN);
    const [, y2] = projection.project(lon, LAT_MAX);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x1, y2);
    ctx.stroke();
    ctx.fillText(`${lon}°E`, x1 + 2, y1 - 4);
  }

  for (let lat = Math.ceil(LAT_MIN / 5) * 5; lat < LAT_MAX; lat += 5) {
    const [x1, y1] = projection.project(LON_MIN, lat);
    const [x2] = projection.project(LON_MAX, lat);
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y1);
    ctx.stroke();
    ctx.fillText(`${lat}°N`, x1 + 2, y1 - 4);
  }
}

function drawPrefectures(
  ctx: SKRSContext2D,
  projection: MapProjection,
  prefectureScales: Map<string, number>,
): void {
  for (const prefecture of JAPAN_PREFECTURE_POLYGONS) {
    const scale = prefectureScales.get(prefecture.name);
    const fillColor = scale != null ? scaleColor(scale) : LAND_DEFAULT_COLOR;

    for (const ring of prefecture.polygons) {
      if (ring.length < 3) continue;
      ctx.beginPath();
      ring.forEach(([lon, lat], index) => {
        const [x, y] = projection.project(lon, lat);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.closePath();
      ctx.fillStyle = fillColor;
      ctx.fill();
      ctx.strokeStyle = LAND_STROKE_COLOR;
      ctx.lineWidth = 0.6;
      ctx.stroke();
    }
  }
}

/** 地震情報カードのタイトル用アイコン（警告三角）。絵文字はキャンバス描画では文字化けするため使わない。 */
function drawWarningTriangleIcon(ctx: SKRSContext2D, cx: number, cy: number, size: number): void {
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(cx, cy - size);
  ctx.lineTo(cx + size * 0.95, cy + size * 0.8);
  ctx.lineTo(cx - size * 0.95, cy + size * 0.8);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#c62828";
  ctx.font = font(Math.round(size * 1.2), true);
  ctx.textAlign = "center";
  ctx.fillText("!", cx, cy + size * 0.62);
  ctx.textAlign = "left";
}

/** 震源地マップのタイトル用アイコン（位置ピン）。 */
function drawPinIcon(ctx: SKRSContext2D, cx: number, cy: number, size: number): void {
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.3, size * 0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.5, cy);
  ctx.lineTo(cx + size * 0.5, cy);
  ctx.lineTo(cx, cy + size * 0.9);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = "#1b3a5c";
  ctx.beginPath();
  ctx.arc(cx, cy - size * 0.3, size * 0.28, 0, Math.PI * 2);
  ctx.fill();
}

function drawStar(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
): void {
  const spikes = 5;
  ctx.beginPath();
  for (let i = 0; i < spikes * 2; i++) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (Math.PI / spikes) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawEpicenterMarker(
  ctx: SKRSContext2D,
  projection: MapProjection,
  hypocenter: JmaQuakeHypocenter | undefined,
): void {
  if (hypocenter?.latitude == null || hypocenter?.longitude == null) return;

  const clampedLon = Math.min(Math.max(hypocenter.longitude, LON_MIN), LON_MAX);
  const clampedLat = Math.min(Math.max(hypocenter.latitude, LAT_MIN), LAT_MAX);
  const [x, y] = projection.project(clampedLon, clampedLat);

  ctx.strokeStyle = "rgba(255, 82, 82, 0.55)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, 20, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#ff1744";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  drawStar(ctx, x, y, 13, 5.5);
  ctx.fill();
  ctx.stroke();
}

function drawMapLegend(ctx: SKRSContext2D, top: number): void {
  const entries: Array<[number, string]> = [
    [SEISMIC_SCALE.S1, "1"],
    [SEISMIC_SCALE.S2, "2"],
    [SEISMIC_SCALE.S3, "3"],
    [SEISMIC_SCALE.S4, "4"],
    [SEISMIC_SCALE.S5_WEAK, "5弱"],
    [SEISMIC_SCALE.S5_STRONG, "5強"],
    [SEISMIC_SCALE.S6_WEAK, "6弱"],
    [SEISMIC_SCALE.S6_STRONG, "6強"],
    [SEISMIC_SCALE.S7, "7"],
  ];

  ctx.fillStyle = "#455a64";
  ctx.font = font(13, true);
  ctx.textAlign = "left";
  ctx.fillText("震度", MAP_PADDING, top + 22);

  const swatchSize = 20;
  const gap = 4;
  let x = MAP_PADDING + 40;
  const swatchY = top + 10;

  for (const [scale, label] of entries) {
    ctx.fillStyle = scaleColor(scale);
    roundRect(ctx, x, swatchY, swatchSize, swatchSize, 4);
    ctx.fill();

    ctx.fillStyle = "#263238";
    ctx.font = font(11, true);
    ctx.textAlign = "center";
    ctx.fillText(label, x + swatchSize / 2, swatchY + swatchSize + 13);

    x += swatchSize + gap + 20;
  }

  const noteY = top + MAP_LEGEND_HEIGHT - 11;
  ctx.fillStyle = "#ff1744";
  drawStar(ctx, MAP_PADDING + 6, noteY - 4, 7, 3);
  ctx.fill();

  ctx.textAlign = "left";
  ctx.font = font(13);
  ctx.fillStyle = "#78909c";
  ctx.fillText("＝ 震源地", MAP_PADDING + 18, noteY);

  const grayX = MAP_PADDING + 110;
  ctx.fillStyle = LAND_DEFAULT_COLOR;
  roundRect(ctx, grayX, noteY - 12, 14, 14, 3);
  ctx.fill();
  ctx.fillStyle = "#78909c";
  ctx.fillText("＝ 震度情報なし", grayX + 20, noteY);
}

function drawMapFooter(ctx: SKRSContext2D, top: number, width: number): void {
  ctx.strokeStyle = "#cfd8dc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(MAP_PADDING, top + 8);
  ctx.lineTo(width - MAP_PADDING, top + 8);
  ctx.stroke();

  ctx.fillStyle = "#78909c";
  ctx.font = font(13);
  ctx.fillText("境界データ: 国土数値情報（簡略化） / 情報提供: 気象庁", MAP_PADDING, top + 30);
}

export function renderEpicenterMapImage(
  hypocenter: JmaQuakeHypocenter | undefined,
  prefectureScales: Map<string, number>,
): Buffer {
  const lonRange = LON_MAX - LON_MIN;
  const latRange = LAT_MAX - LAT_MIN;
  const areaWidth = MAP_CARD_WIDTH - MAP_PADDING * 2;
  const mapAreaHeight = (areaWidth / lonRange) * latRange;

  const height = MAP_HEADER_HEIGHT + mapAreaHeight + MAP_LEGEND_HEIGHT + MAP_FOOTER_HEIGHT;
  const canvas = createCanvas(MAP_CARD_WIDTH, height);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, MAP_CARD_WIDTH, height);

  drawMapHeader(ctx, hypocenter);

  ctx.fillStyle = OCEAN_COLOR;
  ctx.fillRect(0, MAP_HEADER_HEIGHT, MAP_CARD_WIDTH, mapAreaHeight);

  const projection = buildProjection(areaWidth, mapAreaHeight, MAP_HEADER_HEIGHT);
  drawGraticule(ctx, projection);
  drawPrefectures(ctx, projection, prefectureScales);
  drawEpicenterMarker(ctx, projection, hypocenter);

  drawMapLegend(ctx, MAP_HEADER_HEIGHT + mapAreaHeight);
  drawMapFooter(ctx, MAP_HEADER_HEIGHT + mapAreaHeight + MAP_LEGEND_HEIGHT, MAP_CARD_WIDTH);

  return canvas.toBuffer("image/png");
}
