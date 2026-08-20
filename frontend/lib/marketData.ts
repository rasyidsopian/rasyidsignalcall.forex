import type { Candle } from "../types";

const BASE = "https://api.twelvedata.com/time_series";
const KEY_NAME = "twelve_data_api_key";

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
  const response = await fetch(`${BASE}?${params.toString()}`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Market data HTTP ${response.status}`);
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
  const [c1, c5, c15, c1h, c4h] = await Promise.all([
    fetchCandles(apiKey, "1min", 1500),
    fetchCandles(apiKey, "5min", 650),
    fetchCandles(apiKey, "15min", 450),
    fetchCandles(apiKey, "1h", 320),
    fetchCandles(apiKey, "4h", 260),
  ]);
  return { c1, c5, c15, c1h, c4h };
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
  // One REST credit per refresh. We rebuild recent higher-TF candles locally from 1M data.
  const fresh1 = await fetchCandles(apiKey, "1min", 360);
  const c1 = mergeCandles(current.c1, fresh1, 1800);
  const c5 = mergeCandles(current.c5, aggregateCandles(fresh1, 5), 700);
  const c15 = mergeCandles(current.c15, aggregateCandles(fresh1, 15), 500);
  const c1h = mergeCandles(current.c1h, aggregateCandles(fresh1, 60), 350);
  const c4h = mergeCandles(current.c4h, aggregateCandles(fresh1, 240), 280);
  return { c1, c5, c15, c1h, c4h };
}
