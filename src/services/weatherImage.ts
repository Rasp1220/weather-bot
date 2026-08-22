import fs from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import type { WarningCodeInfo } from "../data/warningCodes";
import { formatJstHm } from "../utils/jst";
import { shortWeatherLabel, type PrefectureForecast, type WeatherCategory } from "./jmaForecast";

const FONT_FAMILY = "Noto Sans JP";
const REGULAR_FONT_PATH = path.resolve(process.cwd(), "assets/fonts/NotoSansJP-Regular.ttf");
const BOLD_FONT_PATH = path.resolve(process.cwd(), "assets/fonts/NotoSansJP-Bold.ttf");

if (fs.existsSync(REGULAR_FONT_PATH)) {
  GlobalFonts.registerFromPath(REGULAR_FONT_PATH, FONT_FAMILY);
}
if (fs.existsSync(BOLD_FONT_PATH)) {
  GlobalFonts.registerFromPath(BOLD_FONT_PATH, FONT_FAMILY);
}

const CARD_WIDTH = 820;
const PADDING = 32;
const HEADER_HEIGHT = 116;
const ROW_HEIGHT = 84;
const FOOTER_HEIGHT = 46;
const WARNING_HEADER_HEIGHT = 40;
const WARNING_ROW_HEIGHT = 30;
const WEATHER_TEXT_X = PADDING + 180;

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

export function renderForecastImage(
  prefectureName: string,
  forecast: PrefectureForecast,
  warnings: WarningCodeInfo[] = [],
): Buffer {
  const { periods, temperatures, officeName } = forecast;
  const temperatureByTime = new Map(temperatures.map((point) => [point.time.getTime(), point.temperature]));
  const warningSectionHeight =
    warnings.length > 0 ? WARNING_HEADER_HEIGHT + warnings.length * WARNING_ROW_HEIGHT : 0;
  const height =
    HEADER_HEIGHT + warningSectionHeight + periods.length * ROW_HEIGHT + FOOTER_HEIGHT + PADDING;
  const canvas = createCanvas(CARD_WIDTH, height);
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "alphabetic";

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, "#e3f2fd");
  bg.addColorStop(1, "#ffffff");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, CARD_WIDTH, height);

  // ヘッダー
  const headerGradient = ctx.createLinearGradient(0, 0, CARD_WIDTH, HEADER_HEIGHT);
  headerGradient.addColorStop(0, "#42a5f5");
  headerGradient.addColorStop(1, "#478ed1");
  ctx.fillStyle = headerGradient;
  ctx.fillRect(0, 0, CARD_WIDTH, HEADER_HEIGHT);

  ctx.fillStyle = "#ffffff";
  ctx.font = `bold 34px "${FONT_FAMILY}"`;
  ctx.fillText(`${prefectureName}の天気予報`, PADDING, 56);

  const now = new Date();
  ctx.font = `18px "${FONT_FAMILY}"`;
  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.fillText(
    `情報提供: 気象庁（${officeName}） ・ 取得時刻 ${formatJstHm(now)}`,
    PADDING,
    88,
  );

  // 警報・注意報
  let rowY = HEADER_HEIGHT;
  if (warnings.length > 0) {
    ctx.fillStyle = "#fff3e0";
    ctx.fillRect(0, rowY, CARD_WIDTH, warningSectionHeight);

    ctx.fillStyle = "#e53935";
    ctx.font = `bold 18px "${FONT_FAMILY}"`;
    ctx.textAlign = "left";
    ctx.fillText("発表中の警報・注意報", PADDING, rowY + 27);

    let warningY = rowY + WARNING_HEADER_HEIGHT;
    for (const warning of warnings) {
      const centerY = warningY + WARNING_ROW_HEIGHT / 2;
      const color = WARNING_TIER_COLOR[warning.tier];

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(PADDING + 6, centerY - 5, 6, 0, Math.PI * 2);
      ctx.fill();

      ctx.font = `bold 17px "${FONT_FAMILY}"`;
      ctx.fillText(`[${WARNING_TIER_LABEL[warning.tier]}] ${warning.name}`, PADDING + 22, centerY);

      warningY += WARNING_ROW_HEIGHT;
    }

    rowY += warningSectionHeight;
  }

  // 時間帯別リスト
  periods.forEach((period, index) => {
    if (index % 2 === 1) {
      ctx.fillStyle = "rgba(144, 202, 249, 0.12)";
      ctx.fillRect(0, rowY, CARD_WIDTH, ROW_HEIGHT);
    }

    const centerY = rowY + ROW_HEIGHT / 2;

    ctx.fillStyle = "#263238";
    ctx.font = `bold 20px "${FONT_FAMILY}"`;
    ctx.textAlign = "left";
    ctx.fillText(period.periodLabel, PADDING, centerY - 4);

    drawWeatherIcon(ctx, period.weatherCategory, PADDING + 130, centerY, 1.1);

    ctx.fillStyle = "#37474f";
    ctx.font = `20px "${FONT_FAMILY}"`;
    ctx.fillText(shortWeatherLabel(period.weatherText), WEATHER_TEXT_X, centerY - 4);

    if (period.pop != null) {
      ctx.fillStyle = "#0288d1";
      ctx.font = `16px "${FONT_FAMILY}"`;
      ctx.fillText(`降水確率 ${period.pop}%`, WEATHER_TEXT_X, centerY + 22);
    }

    const temperature = temperatureByTime.get(period.time.getTime());
    if (temperature != null) {
      ctx.fillStyle = "#d84315";
      ctx.font = `bold 28px "${FONT_FAMILY}"`;
      ctx.textAlign = "right";
      ctx.fillText(`${Math.round(temperature)}°C`, CARD_WIDTH - PADDING, centerY + 10);
      ctx.textAlign = "left";
    }

    rowY += ROW_HEIGHT;
  });

  // フッター区切り線
  ctx.strokeStyle = "#cfd8dc";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING, rowY + 8);
  ctx.lineTo(CARD_WIDTH - PADDING, rowY + 8);
  ctx.stroke();

  ctx.fillStyle = "#78909c";
  ctx.font = `14px "${FONT_FAMILY}"`;
  ctx.fillText("気象・災害通知bot", PADDING, rowY + 32);

  return canvas.toBuffer("image/png");
}
