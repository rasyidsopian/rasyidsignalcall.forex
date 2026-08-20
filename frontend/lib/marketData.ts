import type { Candle } from "../types";

const BASE = "https://api.twelvedata.com/time_series";
const WS_BASE = "wss://ws.twelvedata.com/v1/quotes/price";
const KEY_NAME = "twelve_data_api_key";
const FRAME_CACHE = "xau_scalp_frames_v6";
const FRAME_CACHE_AT = "xau_scalp_frames_v6_at";
const CACHE_MAX_AGE_MS = 4 * 60 * 60_000;

export type MarketFrames = {
  c1: Candle[];
  c5: Candle[];
  c15: Candle[];
  c1h: Candle[];
  c4h: Candle[];
};

export type RealtimeTick = {
  symbol: string;
  price: number;
  timestampMs: number;
};

export type StreamState = "CONNECTING" | "LIVE" | "RECONNECTING" | "CLOSED";

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

function validCandle(c: Candle) {
  const ts = new Date(c.timestamp).getTime();
  return Number.isFinite(ts) && ts > 0 && [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.high >= c.low;
}

function sanitizeRows(rows: Candle[], keep: number) {
  const map = new Map<number, Candle>();
  for (const candle of rows) {
    if (!validCandle(candle)) continue;
    map.set(new Date(candle.timestamp).getTime(), candle);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, candle]) => candle)
    .slice(-keep);
}

function sanitizeFrames(frames: MarketFrames): MarketFrames {
  return {
    c1: sanitizeRows(frames.c1, 1800),
    c5: sanitizeRows(frames.c5, 700),
    c15: sanitizeRows(frames.c15, 500),
    c1h: sanitizeRows(frames.c1h, 350),
    c4h: sanitizeRows(frames.c4h, 280),
  };
}

function cacheFrames(frames: MarketFrames) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FRAME_CACHE, JSON.stringify(sanitizeFrames(frames)));
    window.localStorage.setItem(FRAME_CACHE_AT, String(Date.now()));
  } catch {
    // localStorage can be unavailable/full; market data still works without cache.
  }
}

export function cacheMarketFrames(frames: MarketFrames) {
  cacheFrames(frames);
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
    return valid ? sanitizeFrames(parsed) : null;
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
        "Twelve Data rate limit (HTTP 429). Tunggu sampai menit berikutnya lalu SYNC HISTORY. Jika tetap 429, cek kuota API di dashboard Twelve Data.",
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
  return sanitizeRows(payload.values
    .map((v: any) => ({
      timestamp: `${v.datetime.replace(" ", "T")}Z`,
      open: Number(v.open),
      high: Number(v.high),
      low: Number(v.low),
      close: Number(v.close),
      volume: Number(v.volume ?? 0),
    }))
    .reverse(), outputsize);
}

export async function fetchAllTimeframes(apiKey: string): Promise<MarketFrames> {
  // 5 REST credits on a true cold start. Calls are sequential to stay below Basic burst limits.
  const c1 = await fetchCandles(apiKey, "1min", 1500);
  await sleep(1200);
  const c5 = await fetchCandles(apiKey, "5min", 650);
  await sleep(1200);
  const c15 = await fetchCandles(apiKey, "15min", 450);
  await sleep(1200);
  const c1h = await fetchCandles(apiKey, "1h", 320);
  await sleep(1200);
  const c4h = await fetchCandles(apiKey, "4h", 260);
  const frames = sanitizeFrames({ c1, c5, c15, c1h, c4h });
  cacheFrames(frames);
  return frames;
}

function bucketStartMs(timestampMs: number, minutes: number) {
  const ms = minutes * 60_000;
  return Math.floor(timestampMs / ms) * ms;
}

function upsertTick(rows: Candle[], price: number, timestampMs: number, minutes: number, keep: number): Candle[] {
  const startMs = bucketStartMs(timestampMs, minutes);
  const timestamp = new Date(startMs).toISOString();
  const last = rows.at(-1);

  if (last && new Date(last.timestamp).getTime() === startMs) {
    const next = rows.slice();
    next[next.length - 1] = {
      ...last,
      high: Math.max(last.high, price),
      low: Math.min(last.low, price),
      close: price,
    };
    return next;
  }

  if (last && new Date(last.timestamp).getTime() > startMs) return rows;

  const candle: Candle = {
    timestamp,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 0,
  };
  return [...rows, candle].slice(-keep);
}

export function applyRealtimeTick(frames: MarketFrames, tick: RealtimeTick): MarketFrames {
  const lastMs = frames.c1.at(-1) ? new Date(frames.c1.at(-1)!.timestamp).getTime() : 0;
  // Ignore severely out-of-order provider events so a stale tick cannot corrupt chart chronology.
  if (lastMs && tick.timestampMs < lastMs - 90_000) return frames;
  const safeTimestamp = tick.timestampMs > Date.now() + 60_000 ? Date.now() : tick.timestampMs;
  // V6 hot path: rows were sanitized on load/cache. Do not re-scan thousands of candles on every tick.
  return {
    c1: upsertTick(frames.c1, tick.price, safeTimestamp, 1, 1800),
    c5: upsertTick(frames.c5, tick.price, safeTimestamp, 5, 700),
    c15: upsertTick(frames.c15, tick.price, safeTimestamp, 15, 500),
    c1h: upsertTick(frames.c1h, tick.price, safeTimestamp, 60, 350),
    c4h: upsertTick(frames.c4h, tick.price, safeTimestamp, 240, 280),
  };
}

function mergeCandles(base: Candle[], recent: Candle[], keep = 700) {
  const map = new Map<string, Candle>();
  for (const candle of base) map.set(candle.timestamp, candle);
  for (const candle of recent) map.set(candle.timestamp, candle);
  return [...map.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)).slice(-keep);
}

function bucketStart(timestamp: string, minutes: number) {
  return new Date(bucketStartMs(new Date(timestamp).getTime(), minutes)).toISOString();
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

export async function refreshFromOneMinute(apiKey: string, current: MarketFrames): Promise<MarketFrames> {
  // Manual resync uses one REST credit. Higher-TF current bars are rebuilt locally from recent 1M data.
  const fresh1 = await fetchCandles(apiKey, "1min", 360);
  const c1 = mergeCandles(current.c1, fresh1, 1800);
  const c5 = mergeCandles(current.c5, aggregateCandles(fresh1, 5), 700);
  const c15 = mergeCandles(current.c15, aggregateCandles(fresh1, 15), 500);
  const c1h = mergeCandles(current.c1h, aggregateCandles(fresh1, 60), 350);
  const c4h = mergeCandles(current.c4h, aggregateCandles(fresh1, 240), 280);
  const frames = sanitizeFrames({ c1, c5, c15, c1h, c4h });
  cacheFrames(frames);
  return frames;
}

export function connectRealtimeXauUsd(
  apiKey: string,
  handlers: {
    onTick: (tick: RealtimeTick) => void;
    onState?: (state: StreamState) => void;
    onError?: (message: string) => void;
  },
) {
  let socket: WebSocket | null = null;
  let heartbeat: number | null = null;
  let reconnectTimer: number | null = null;
  let closedByClient = false;
  let reconnectAttempt = 0;

  const cleanupSocket = () => {
    if (heartbeat != null) window.clearInterval(heartbeat);
    heartbeat = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onclose = null;
      try { socket.close(); } catch {}
    }
    socket = null;
  };

  const scheduleReconnect = () => {
    if (closedByClient) return;
    handlers.onState?.("RECONNECTING");
    const delay = Math.min(30_000, 1_500 * 2 ** Math.min(reconnectAttempt, 4));
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(open, delay);
  };

  const open = () => {
    if (closedByClient) return;
    cleanupSocket();
    handlers.onState?.(reconnectAttempt ? "RECONNECTING" : "CONNECTING");
    const ws = new WebSocket(`${WS_BASE}?apikey=${encodeURIComponent(apiKey)}`);
    socket = ws;

    ws.onopen = () => {
      reconnectAttempt = 0;
      ws.send(JSON.stringify({ action: "subscribe", params: { symbols: "XAU/USD" } }));
      heartbeat = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ action: "heartbeat" }));
      }, 10_000);
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(String(event.data));
        if (payload?.event === "subscribe-status") {
          const ok = payload?.status === "ok" || payload?.success?.length > 0;
          if (ok) handlers.onState?.("LIVE");
          if (payload?.status === "error") handlers.onError?.(payload?.message ?? "WebSocket subscription failed");
          return;
        }
        if (payload?.event === "price" || payload?.price != null) {
          const price = Number(payload.price);
          const rawTs = Number(payload.timestamp);
          const timestampMs = Number.isFinite(rawTs) ? (rawTs > 10_000_000_000 ? rawTs : rawTs * 1000) : Date.now();
          if (Number.isFinite(price) && price > 0) {
            handlers.onState?.("LIVE");
            handlers.onTick({ symbol: String(payload.symbol ?? "XAU/USD"), price, timestampMs });
          }
        }
      } catch {
        // Ignore malformed/non-price payloads and keep the stream alive.
      }
    };

    ws.onerror = () => handlers.onError?.("WebSocket XAU/USD mengalami network error; mencoba reconnect otomatis.");
    ws.onclose = () => {
      cleanupSocket();
      scheduleReconnect();
    };
  };

  open();

  return () => {
    closedByClient = true;
    if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    cleanupSocket();
    handlers.onState?.("CLOSED");
  };
}
