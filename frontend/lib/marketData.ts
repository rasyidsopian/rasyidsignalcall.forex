import type { Candle } from "../types";

const BASE = "https://api.twelvedata.com/time_series";
const KEY_NAME = "twelve_data_api_key";
const FRAME_CACHE = "xau_scalp_frames_v21";
const FRAME_CACHE_AT = "xau_scalp_frames_v21_at";
const CACHE_MAX_AGE_MS = 15 * 60_000;

export type MarketFrames = {
  c1: Candle[];
  c5: Candle[];
  c15: Candle[];
  c1h: Candle[];
  c4h: Candle[];
};

export function getSavedApiKey() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(KEY_NAME) ?? "";
}

export function saveApiKey(key: string) {
  window.localStorage.setItem(KEY_NAME, key.trim());
}

export function clearApiKey() {
  window.localStorage.removeItem(KEY_NAME);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheFrames(frames: MarketFrames) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FRAME_CACHE, JSON.stringify(frames));
    window.localStorage.setItem(FRAME_CACHE_AT, String(Date.now()));
  } catch {
    // localStorage can be unavailable/full; market data still works without cache.
  }
}

export function getCachedFrames(maxAgeMs = CACHE_MAX_AGE_MS): MarketFrames | null {
  if (typeof window === "undefined") return null;
  try {
    const at = Number(window.localStorage.getItem(FRAME_CACHE_AT) ?? "0");
    if (!at || Date.now() - at > maxAgeMs) return null;
    const parsed = JSON.parse(window.localStorage.getItem(FRAME_CACHE) ?? "null") as MarketFrames | null;
    if (!parsed) return null;
    const valid = [parsed.c1, parsed.c5, parsed.c15, parsed.c1h, parsed.c4h].every(
      (rows) => Array.isArray(rows) && rows.length >= 205,
    );
    return valid ? parsed : null;
  } catch {
    return null;
  }
}

async function requestTimeSeries(url: string, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, { cache: "no-store" });
    if (response.status !== 429) return response;

    if (attempt === maxRetries) {
      throw new Error(
        "Twelve Data rate limit (HTTP 429). Tunggu sampai menit berikutnya lalu REFRESH NOW. Jika tetap 429, kemungkinan kuota Basic 800/hari sudah habis.",
      );
    }

    const retryAfter = Number(response.headers.get("retry-after") ?? "0");
    const delayMs = retryAfter > 0 ? retryAfter * 1000 : 15_000;
    await sleep(delayMs);
  }
  throw new Error("Market data request failed");
}

export async function fetchCandles(
  apiKey: string,
  interval: "1min" | "5min" | "15min" | "1h" | "4h",
  outputsize: number,
): Promise<Candle[]> {
  const params = new URLSearchParams({
    symbol: "XAU/USD",
    interval,
    outputsize: String(outputsize),
    apikey: apiKey,
    format: "JSON",
    timezone: "UTC",
  });
  const response = await requestTimeSeries(`${BASE}?${params.toString()}`);
  if (!response.ok) {
    let detail = "";
    try {
      const payload = await response.json();
      detail = payload?.message ? ` · ${payload.message}` : "";
    } catch {}
    throw new Error(`Market data HTTP ${response.status}${detail}`);
  }
  const payload = await response.json();
  if (payload.status === "error" || !Array.isArray(payload.values)) {
    throw new Error(payload.message ?? "Twelve Data tidak mengembalikan candle XAU/USD");
  }
  return payload.values
    .map((v: any) => ({
      timestamp: `${v.datetime.replace(" ", "T")}Z`,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: Number(v.volume ?? 0),
    }))
    .reverse();
}

export async function fetchAllTimeframes(apiKey: string): Promise<MarketFrames> {
  // Cold start only. Calls are sequential instead of a 5-request burst to be kinder to Basic limits.
  const c1 = await fetchCandles(apiKey, "1min", 1500);
  await sleep(1200);
  const c5 = await fetchCandles(apiKey, "5min", 650);
  await sleep(1200);
  const c15 = await fetchCandles(apiKey, "15min", 450);
  await sleep(1200);
  const c1h = await fetchCandles(apiKey, "1h", 320);
  await sleep(1200);
  const c4h = await fetchCandles(apiKey, "4h", 260);
  const frames = { c1, c5, c15, c1h, c4h };
  cacheFrames(frames);
  return frames;
}

function bucketStart(timestamp: string, minutes: number) {
  const d = new Date(timestamp);
  const ms = minutes * 60_000;
  return new Date(Math.floor(d.getTime() / ms) * ms).toISOString();
}

export function aggregateCandles(c1: Candle[], minutes: number): Candle[] {
  const buckets = new Map<string, Candle[]>();
  for (const candle of c1) {
    const key = bucketStart(candle.timestamp, minutes);
    const group = buckets.get(key) ?? [];
    group.push(candle);
    buckets.set(key, group);
  }
  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([timestamp, rows]) => ({
      timestamp,
      open: rows[0].open,
      high: Math.max(...rows.map((r) => r.high)),
      low: Math.min(...rows.map((r) => r.low)),
      close: rows.at(-1)!.close,
      volume: rows.reduce((s, r) => s + (r.volume || 0), 0),
    }));
}

function mergeCandles(base: Candle[], recent: Candle[], keep = 700) {
  const map = new Map<string, Candle>();
  for (const candle of base) map.set(candle.timestamp, candle);
  for (const candle of recent) map.set(candle.timestamp, candle);
  return [...map.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-keep);
}

export async function refreshFromOneMinute(apiKey: string, current: MarketFrames): Promise<MarketFrames> {
  // One REST credit per refresh. Recent higher-TF candles are rebuilt locally from 1M data.
  const fresh1 = await fetchCandles(apiKey, "1min", 360);
  const c1 = mergeCandles(current.c1, fresh1, 1800);
  const c5 = mergeCandles(current.c5, aggregateCandles(fresh1, 5), 700);
  const c15 = mergeCandles(current.c15, aggregateCandles(fresh1, 15), 500);
  const c1h = mergeCandles(current.c1h, aggregateCandles(fresh1, 60), 350);
  const c4h = mergeCandles(current.c4h, aggregateCandles(fresh1, 240), 280);
  const frames = { c1, c5, c15, c1h, c4h };
  cacheFrames(frames);
  return frames;
}
