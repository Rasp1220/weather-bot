import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { WarningCodeInfo } from "../data/warningCodes";
import { ensureFontsRegistered, FONT_FAMILY } from "../utils/fonts";
import { formatJstHm, jstDayDiff, formatJstMonthDay } from "../utils/jst";
import type { DailyTemperature, PrefectureForecast } from "./jmaForecast";
import { shortWeatherLabel, type WeatherCategory } from "./jmaWeatherText";

ensureFontsRegistered();

const CARD_WIDTH = 820;
const PADDING = 32;
const HEADER_HEIGHT = 116;
const ROW_HEIGHT = 84;
const FOOTER_HEIGHT = 46;
const WARNING_HEADER_HEIGHT = 40;
const WARNING_ROW_HEIGHT = 30;
const TEMPERATURE_SECTION_HEIGHT = 74;
const WEATHER_TEXT_X = PADDING + 180;
/** 気温欄に表示する日数（今日・明日）。 */
const TEMPERATURE_DAYS = 2;
/** 降水確率を表示する下限(%)。0% のときは情報量が無いので表示しない。 */
const POP_DISPLAY_THRESHOLD = 10;

const WARNING_TIER_COLOR: Record<WarningCodeInfo["tier"], string> = {
  special: "#8e24aa",
  warning: "#e53935",
  advisory: "#fb8c00",
};

const WARNING_TIER_LABEL: Record<WarningCodeInfo["tier"], string> = {
  special: "特別警報",
  warning: "警報",
  advisory: "注意報",
};

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

function drawCloud(ctx: SKRSContext2D, cx: number, cy: number, scale: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx - 14 * scale, cy + 4 * scale, 12 * scale, 0, Math.PI * 2);
  ctx.arc(cx + 2 * scale, cy - 6 * scale, 15 * scale, 0, Math.PI * 2);
  ctx.arc(cx + 18 * scale, cy + 2 * scale, 12 * scale, 0, Math.PI * 2);
  ctx.closePath();
  ctx.fill();
  roundRect(ctx, cx - 24 * scale, cy + 2 * scale, 56 * scale, 16 * scale, 8 * scale);
  ctx.fill();
}

function drawSun(ctx: SKRSContext2D, cx: number, cy: number, scale: number): void {
  ctx.fillStyle = "#ffb300";
  ctx.strokeStyle = "#ffb300";
  ctx.lineWidth = 3 * scale;
  ctx.lineCap = "round";
  for (let i = 0; i < 8; i++) {
    const angle = (Math.PI / 4) * i;
    const x1 = cx + Math.cos(angle) * 16 * scale;
    const y1 = cy + Math.sin(angle) * 16 * scale;
    const x2 = cx + Math.cos(angle) * 23 * scale;
    const y2 = cy + Math.sin(angle) * 23 * scale;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 13 * scale, 0, Math.PI * 2);
  ctx.fill();
}

function drawRainDrops(ctx: SKRSContext2D, cx: number, cy: number, scale: number, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3 * scale;
  ctx.lineCap = "round";
  const offsets = [-14, 0, 14];
  for (const dx of offsets) {
    ctx.beginPath();
    ctx.moveTo(cx + dx * scale, cy + 20 * scale);
    ctx.lineTo(cx + (dx - 4) * scale, cy + 30 * scale);
    ctx.stroke();
  }
}

function drawSnowflakes(ctx: SKRSContext2D, cx: number, cy: number, scale: number): void {
  ctx.fillStyle = "#90caf9";
  const offsets = [-14, 0, 14];
  for (const dx of offsets) {
    ctx.beginPath();
    ctx.arc(cx + dx * scale, cy + 26 * scale, 3 * scale, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawBolt(ctx: SKRSContext2D, cx: number, cy: number, scale: number): void {
  ctx.fillStyle = "#fdd835";
  ctx.beginPath();
  ctx.moveTo(cx + 4 * scale, cy + 14 * scale);
  ctx.lineTo(cx - 8 * scale, cy + 30 * scale);
  ctx.lineTo(cx, cy + 30 * scale);
  ctx.lineTo(cx - 4 * scale, cy + 44 * scale);
  ctx.lineTo(cx + 10 * scale, cy + 26 * scale);
  ctx.lineTo(cx + 2 * scale, cy + 26 * scale);
  ctx.closePath();
  ctx.fill();
}

function drawWeatherIcon(
  ctx: SKRSContext2D,
  category: WeatherCategory,
  cx: number,
  cy: number,
  scale = 1,
): void {
  switch (category) {
    case "sun":
      drawSun(ctx, cx, cy, scale);
      break;
    case "sun-cloud":
      drawSun(ctx, cx - 8 * scale, cy - 8 * scale, scale * 0.75);
      drawCloud(ctx, cx + 6 * scale, cy + 6 * scale, scale * 0.8, "#eceff1");
      break;
    case "cloud":
      drawCloud(ctx, cx, cy, scale, "#b0bec5");
      break;
    case "fog":
      drawCloud(ctx, cx, cy - 6 * scale, scale * 0.8, "#cfd8dc");
      ctx.strokeStyle = "#90a4ae";
      ctx.lineWidth = 3 * scale;
      ctx.lineCap = "round";
      for (const dy of [16, 24]) {
        ctx.beginPath();
        ctx.moveTo(cx - 18 * scale, cy + dy * scale);
        ctx.lineTo(cx + 18 * scale, cy + dy * scale);
        ctx.stroke();
      }
      break;
    case "rain":
      drawCloud(ctx, cx, cy - 6 * scale, scale * 0.85, "#78909c");
      drawRainDrops(ctx, cx, cy - 4 * scale, scale, "#4fc3f7");
      break;
    case "snow":
      drawCloud(ctx, cx, cy - 6 * scale, scale * 0.85, "#cfd8dc");
      drawSnowflakes(ctx, cx, cy - 4 * scale, scale);
      break;
    case "thunder":
      drawCloud(ctx, cx, cy - 10 * scale, scale * 0.85, "#546e7a");
      drawBolt(ctx, cx, cy - 14 * scale, scale * 0.7);
      break;
  }
}

function font(size: number, bold = false): string {
  return `${bold ? "bold " : ""}${size}px "${FONT_FAMILY}"`;
}

function drawBackground(ctx: SKRSContext2D, height: number): void {
  const background = ctx.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#e3f2fd");
  background.addColorStop(1, "#ffffff");
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, CARD_WIDTH, height);
}

function drawHeader(ctx: SKRSContext2D, prefectureName: string, officeName: string): void {
  const gradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, HEADER_HEIGHT);
  gradient.addColorStop(0, "#42a5f5");
  gradient.addColorStop(1, "#478ed1");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, CARD_WIDTH, HEADER_HEIGHT);

  ctx.fillStyle = "#ffffff";
  ctx.font = font(34, true);
  ctx.fillText(`${prefectureName}の天気予報`, PADDING, 56);

  ctx.font = font(18);
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillText(`情報提供: 気象庁（${officeName}） ・ 取得時刻 ${formatJstHm(new Date())}`, PADDING, 88);
}

function formatDayLabel(date: Date, now: Date): string {
  const dayDiff = jstDayDiff(date, now);
  if (dayDiff <= 0) return "今日";
  if (dayDiff === 1) return "明日";
  return formatJstMonthDay(date);
}

/** 最高・最低気温を1日分描画する。 */
function drawDayTemperature(
  ctx: SKRSContext2D,
  entry: DailyTemperature,
  now: Date,
  left: number,
  width: number,
  top: number,
): void {
  ctx.textAlign = "left";
  ctx.fillStyle = "#546e7a";
  ctx.font = font(17, true);
  ctx.fillText(formatDayLabel(entry.date, now), left, top + 30);

  const valueY = top + 48;
  const format = (value: number | undefined): string =>
    value == null ? "--" : `${Math.round(value)}°C`;

  ctx.font = font(14);
  ctx.fillStyle = "#78909c";
  ctx.fillText("最高", left, valueY);
  ctx.fillStyle = "#d84315";
  ctx.font = font(26, true);
  ctx.fillText(format(entry.max), left + 34, valueY + 2);

  const minLeft = left + Math.min(width / 2, 130);
  ctx.font = font(14);
  ctx.fillStyle = "#78909c";
  ctx.fillText("最低", minLeft, valueY);
  ctx.fillStyle = "#0277bd";
  ctx.font = font(26, true);
  ctx.fillText(format(entry.min), minLeft + 34, valueY + 2);
}

/**
 * 日別の最高・最低気温を描画し、次のセクションの開始 Y 座標を返す。
 * 気象庁は時間別の気温を発表しないため、気温はこの粒度でのみ表示する。
 */
function drawTemperatureSection(
  ctx: SKRSContext2D,
  dailyTemperatures: DailyTemperature[],
  top: number,
): number {
  const now = new Date();
  // 発表内容に前日分が残っている場合に「今日」として出さないよう、過去日は落とす。
  const days = dailyTemperatures
    .filter((entry) => jstDayDiff(entry.date, now) >= 0)
    .slice(0, TEMPERATURE_DAYS);
  if (days.length === 0) return top;

  ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
  ctx.fillRect(0, top, CARD_WIDTH, TEMPERATURE_SECTION_HEIGHT);

  const usableWidth = CARD_WIDTH - PADDING * 2;
  const columnWidth = usableWidth / days.length;

  days.forEach((entry, index) => {
    drawDayTemperature(ctx, entry, now, PADDING + columnWidth * index, columnWidth, top);
  });

  ctx.strokeStyle = "#cfd8dc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, top + TEMPERATURE_SECTION_HEIGHT - 1);
  ctx.lineTo(CARD_WIDTH - PADDING, top + TEMPERATURE_SECTION_HEIGHT - 1);
  ctx.stroke();

  return top + TEMPERATURE_SECTION_HEIGHT;
}

/** 発表中の警報・注意報を描画し、次のセクションの開始 Y 座標を返す。 */
function drawWarningSection(ctx: SKRSContext2D, warnings: WarningCodeInfo[], top: number): number {
  if (warnings.length === 0) return top;

  const sectionHeight = WARNING_HEADER_HEIGHT + warnings.length * WARNING_ROW_HEIGHT;
  ctx.fillStyle = "#fff3e0";
  ctx.fillRect(0, top, CARD_WIDTH, sectionHeight);

  ctx.fillStyle = "#e53935";
  ctx.font = font(18, true);
  ctx.textAlign = "left";
  ctx.fillText("発表中の警報・注意報", PADDING, top + 27);

  let rowY = top + WARNING_HEADER_HEIGHT;
  for (const warning of warnings) {
    const centerY = rowY + WARNING_ROW_HEIGHT / 2;

    ctx.fillStyle = WARNING_TIER_COLOR[warning.tier];
    ctx.beginPath();
    ctx.arc(PADDING + 6, centerY - 5, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = font(17, true);
    ctx.fillText(`[${WARNING_TIER_LABEL[warning.tier]}] ${warning.name}`, PADDING + 22, centerY);

    rowY += WARNING_ROW_HEIGHT;
  }

  return top + sectionHeight;
}

function drawForecastRow(
  ctx: SKRSContext2D,
  period: PrefectureForecast["periods"][number],
  temperature: number | undefined,
  top: number,
  striped: boolean,
): void {
  if (striped) {
    ctx.fillStyle = "rgba(144, 202, 249, 0.12)";
    ctx.fillRect(0, top, CARD_WIDTH, ROW_HEIGHT);
  }

  const centerY = top + ROW_HEIGHT / 2;

  ctx.fillStyle = "#263238";
  ctx.font = font(20, true);
  ctx.textAlign = "left";
  ctx.fillText(period.periodLabel, PADDING, centerY - 4);

  drawWeatherIcon(ctx, period.weatherCategory, PADDING + 130, centerY, 1.1);

  ctx.fillStyle = "#37474f";
  ctx.font = font(20);
  ctx.fillText(shortWeatherLabel(period.weatherText), WEATHER_TEXT_X, centerY - 4);

  if (period.pop != null && period.pop >= POP_DISPLAY_THRESHOLD) {
    ctx.fillStyle = "#0288d1";
    ctx.font = font(16);
    ctx.fillText(`降水確率 ${period.pop}%`, WEATHER_TEXT_X, centerY + 22);
  }

  if (temperature != null) {
    ctx.fillStyle = "#d84315";
    ctx.font = font(28, true);
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(temperature)}°C`, CARD_WIDTH - PADDING, centerY + 10);
    ctx.textAlign = "left";
  }
}

function drawFooter(ctx: SKRSContext2D, top: number): void {
  ctx.strokeStyle = "#cfd8dc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, top + 8);
  ctx.lineTo(CARD_WIDTH - PADDING, top + 8);
  ctx.stroke();

  ctx.fillStyle = "#78909c";
  ctx.font = font(14);
  ctx.fillText("気象・災害通知bot", PADDING, top + 32);
}

function cardHeight(periodCount: number, warningCount: number, temperatureDays: number): number {
  const warningSectionHeight =
    warningCount > 0 ? WARNING_HEADER_HEIGHT + warningCount * WARNING_ROW_HEIGHT : 0;
  const temperatureSectionHeight = temperatureDays > 0 ? TEMPERATURE_SECTION_HEIGHT : 0;
  return (
    HEADER_HEIGHT +
    warningSectionHeight +
    temperatureSectionHeight +
    periodCount * ROW_HEIGHT +
    FOOTER_HEIGHT +
    PADDING
  );
}

/** 実際に描画する気温欄の日数（過去日を除いた今日以降、最大 TEMPERATURE_DAYS 日）。 */
function countTemperatureDays(dailyTemperatures: DailyTemperature[], now: Date): number {
  return Math.min(
    dailyTemperatures.filter((entry) => jstDayDiff(entry.date, now) >= 0).length,
    TEMPERATURE_DAYS,
  );
}

export function renderForecastImage(
  prefectureName: string,
  forecast: PrefectureForecast,
  warnings: WarningCodeInfo[] = [],
): Buffer {
  const { periods, dailyTemperatures, temperatures, officeName } = forecast;
  const temperatureByTime = new Map(
    temperatures.map((point) => [point.time.getTime(), point.temperature]),
  );
  const temperatureDays = countTemperatureDays(dailyTemperatures, new Date());

  const height = cardHeight(periods.length, warnings.length, temperatureDays);
  const canvas = createCanvas(CARD_WIDTH, height);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";

  drawBackground(ctx, height);
  drawHeader(ctx, prefectureName, officeName);

  let rowY = drawWarningSection(ctx, warnings, HEADER_HEIGHT);
  rowY = drawTemperatureSection(ctx, dailyTemperatures, rowY);

  periods.forEach((period, index) => {
    drawForecastRow(ctx, period, temperatureByTime.get(period.time.getTime()), rowY, index % 2 === 1);
    rowY += ROW_HEIGHT;
  });

  drawFooter(ctx, rowY);

  return canvas.toBuffer("image/png");
}
