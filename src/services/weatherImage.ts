import fs from "node:fs";
import path from "node:path";
import { createCanvas, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";
import type { HourlyForecastEntry } from "./openMeteo";
import type { WeatherCategory } from "../data/weatherCodes";

const FONT_PATH = path.resolve(process.cwd(), "assets/fonts/ipag.ttf");
const FONT_FAMILY = "IPAGothic";

if (fs.existsSync(FONT_PATH)) {
  GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);
}

const CARD_WIDTH = 820;
const PADDING = 32;
const HEADER_HEIGHT = 116;
const GRAPH_HEIGHT = 170;
const ROW_HEIGHT = 68;
const FOOTER_HEIGHT = 46;

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

function formatHour(date: Date): string {
  return `${date.getHours().toString().padStart(2, "0")}時`;
}

export function renderForecastImage(prefectureName: string, entries: HourlyForecastEntry[]): Buffer {
  const height = HEADER_HEIGHT + GRAPH_HEIGHT + entries.length * ROW_HEIGHT + FOOTER_HEIGHT + PADDING;
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
    `情報提供: Open-Meteo ・ 取得時刻 ${now.getHours().toString().padStart(2, "0")}:${now
      .getMinutes()
      .toString()
      .padStart(2, "0")}`,
    PADDING,
    88,
  );

  // 気温グラフ
  const graphTop = HEADER_HEIGHT + 34;
  const graphBottom = HEADER_HEIGHT + GRAPH_HEIGHT - 30;
  const graphLeft = PADDING + 10;
  const graphRight = CARD_WIDTH - PADDING - 10;
  const temps = entries.map((e) => e.temperature);
  const minTemp = Math.min(...temps);
  const maxTemp = Math.max(...temps);
  const tempSpan = Math.max(maxTemp - minTemp, 1);

  const pointX = (index: number): number =>
    entries.length === 1
      ? (graphLeft + graphRight) / 2
      : graphLeft + ((graphRight - graphLeft) * index) / (entries.length - 1);
  const pointY = (temp: number): number =>
    graphBottom - ((temp - minTemp) / tempSpan) * (graphBottom - graphTop);

  ctx.strokeStyle = "#ff7043";
  ctx.lineWidth = 3;
  ctx.beginPath();
  entries.forEach((entry, index) => {
    const x = pointX(index);
    const y = pointY(entry.temperature);
    if (index === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();

  entries.forEach((entry, index) => {
    const x = pointX(index);
    const y = pointY(entry.temperature);

    ctx.fillStyle = "#ff7043";
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = "#37474f";
    ctx.font = `bold 15px "${FONT_FAMILY}"`;
    ctx.textAlign = "center";
    ctx.fillText(`${Math.round(entry.temperature)}℃`, x, y - 12);

    ctx.fillStyle = "#607d8b";
    ctx.font = `13px "${FONT_FAMILY}"`;
    ctx.fillText(formatHour(entry.time), x, graphBottom + 22);
  });
  ctx.textAlign = "left";

  // 時間別リスト
  let rowY = HEADER_HEIGHT + GRAPH_HEIGHT;
  entries.forEach((entry, index) => {
    if (index % 2 === 1) {
      ctx.fillStyle = "rgba(144, 202, 249, 0.12)";
      ctx.fillRect(0, rowY, CARD_WIDTH, ROW_HEIGHT);
    }

    const centerY = rowY + ROW_HEIGHT / 2;

    ctx.fillStyle = "#263238";
    ctx.font = `bold 18px "${FONT_FAMILY}"`;
    ctx.textAlign = "left";
    ctx.fillText(formatHour(entry.time), PADDING, centerY + 6);

    drawWeatherIcon(ctx, entry.weatherCategory, PADDING + 110, centerY, 1.1);

    ctx.fillStyle = "#37474f";
    ctx.font = `18px "${FONT_FAMILY}"`;
    ctx.fillText(entry.weatherLabel, PADDING + 160, centerY + 6);

    ctx.fillStyle = "#d84315";
    ctx.font = `bold 22px "${FONT_FAMILY}"`;
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(entry.temperature)}℃`, CARD_WIDTH - PADDING, centerY + 7);
    ctx.textAlign = "left";

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
