import type { BacktestStats } from "../types";
import type { MarketFrames } from "./marketData";
import {
  DEFAULT_ACCOUNT as V7_DEFAULT_ACCOUNT,
  backtestDailyMapped,
  backtestTightScalp,
  buildDailySetup,
  buildPredictions,
  buildScalpingSetup,
  type AccountConfig,
  type HorizonPrediction,
  type TradeSetup,
} from "./strategyV7";

export type { AccountConfig, HorizonPrediction, TradeSetup };
export { backtestDailyMapped, backtestTightScalp, buildDailySetup, buildPredictions };

export type ZoneState =
  | "FORMING"
  | "READY"
  | "IN_ZONE"
  | "TRIGGERED"
  | "MISSED"
  | "TP1_REACHED_WITHOUT_ENTRY"
  | "INVALIDATED"
  | "EXPIRED"
  | "REPLACED";

export type SetupType =
  | "Liquidity Sweep + Fib"
  | "5M Pullback"
  | "Breakout Retest"
  | "Micro Structure + Fib";

export type AdaptiveZone = TradeSetup & {
  id: string;
  state: ZoneState;
  createdAt: number;
  updatedAt: number;
  structureVersion: string;
  setupType: SetupType;
  entered: boolean;
  triggeredAt: number | null;
  lifecycleReason: string;
};

export type ZoneArchive = {
  id: string;
  createdAt: number;
  closedAt: number;
  side: "BUY" | "SELL";
  setupType: SetupType;
  state: ZoneState;
  entryZoneLow: number;
  entryZoneHigh: number;
  exactEntry: number;
  stop: number;
  tp1: number;
  tp2: number;
  score: number;
  entered: boolean;
  reason: string;
};

export type ZoneEvaluation = {
  zone: AdaptiveZone;
  archived: ZoneArchive | null;
  replaced: boolean;
};

export const DEFAULT_ACCOUNT: AccountConfig = {
  ...V7_DEFAULT_ACCOUNT,
  pipSize: 0.10,
  maxScalpStopPips: 25,
};

export const DATA_STALE_THRESHOLD_MS = 5_000;
export const MIN_REPLACEMENT_ADVANTAGE = 6;
export const ZONE_STALE_MS = 60_000;
export const MIN_REMAP_INTERVAL_MS = 500;

const round2 = (n: number) => Math.round(n * 100) / 100;
const zoneMid = (z: Pick<TradeSetup, "entryZoneLow" | "entryZoneHigh">) => (z.entryZoneLow + z.entryZoneHigh) / 2;

function structureVersion(frames: MarketFrames) {
  const c1 = frames.c1.at(-1);
  const c5 = frames.c5.at(-1);
  return [c1?.timestamp ?? "", c5?.timestamp ?? "", c1?.high?.toFixed(2) ?? "", c1?.low?.toFixed(2) ?? "", c5?.high?.toFixed(2) ?? "", c5?.low?.toFixed(2) ?? ""].join("|");
}

function classifySetup(setup: TradeSetup): SetupType {
  const a1 = setup.timeframeAnalysis.find((r) => r.timeframe === "1m");
  const a5 = setup.timeframeAnalysis.find((r) => r.timeframe === "5m");
  const struct = `${a1?.structure ?? ""} ${a5?.structure ?? ""}`.toUpperCase();
  const fibSpanLow = Math.min(setup.fib.fib618, setup.fib.fib705);
  const fibSpanHigh = Math.max(setup.fib.fib618, setup.fib.fib705);
  const fibOverlap = zoneMid(setup) >= fibSpanLow - 0.35 && zoneMid(setup) <= fibSpanHigh + 0.35;

  if (struct.includes("BREAK") || struct.includes("BOS") || struct.includes("CHOCH")) return "Breakout Retest";
  if (setup.reasons.some((r) => r.toLowerCase().includes("sweep")) && fibOverlap) return "Liquidity Sweep + Fib";
  if (a5 && a5.bias === setup.side && Math.abs(a5.directionalScore) >= 25) return "5M Pullback";
  return fibOverlap ? "Micro Structure + Fib" : "5M Pullback";
}

export function buildAdaptiveCandidate(frames: MarketFrames, config: AccountConfig, nowMs = Date.now()): AdaptiveZone {
  const setup = buildScalpingSetup(frames, config, nowMs);
  const setupType = classifySetup(setup);
  return {
    ...setup,
    id: `z8-${nowMs}-${setup.side}-${setup.exactEntry.toFixed(2)}`,
    state: setup.predictiveAction === "ENTER_NOW" ? "IN_ZONE" : "READY",
    createdAt: nowMs,
    updatedAt: nowMs,
    structureVersion: structureVersion(frames),
    setupType,
    entered: false,
    triggeredAt: null,
    lifecycleReason: "Fresh best-current mapped zone",
  };
}

export function updateZoneHot(zone: AdaptiveZone, price: number, nowMs: number, pipSize: number): AdaptiveZone {
  if (!Number.isFinite(price) || price <= 0) return zone;
  const tolerance = Math.max(pipSize * 0.2, 0.01);
  const inside = price >= zone.entryZoneLow - tolerance && price <= zone.entryZoneHigh + tolerance;

  if (inside) {
    return {
      ...zone,
      state: "TRIGGERED",
      entered: true,
      triggeredAt: zone.triggeredAt ?? nowMs,
      updatedAt: nowMs,
      predictiveAction: "ENTER_NOW",
      status: `ENTER ${zone.side} NOW`,
      lifecycleReason: "Price is inside the active mapped entry zone",
    };
  }

  if (zone.entered && zone.triggeredAt && nowMs - zone.triggeredAt < 1_000) {
    return { ...zone, updatedAt: nowMs, state: "TRIGGERED", predictiveAction: "ENTER_NOW", status: `ENTER ${zone.side} NOW` };
  }

  return {
    ...zone,
    updatedAt: nowMs,
    state: "READY",
    predictiveAction: zone.side === "BUY" ? (price < zone.entryZoneLow ? "WAIT_RECLAIM" : "WAIT_PULLBACK") : (price > zone.entryZoneHigh ? "WAIT_RECLAIM" : "WAIT_PULLBACK"),
    status: `WAIT FOR ${zone.side} ZONE`,
    lifecycleReason: "Active zone remains valid; waiting for price",
  };
}

function archive(zone: AdaptiveZone, state: ZoneState, reason: string, nowMs: number): ZoneArchive {
  return {
    id: zone.id,
    createdAt: zone.createdAt,
    closedAt: nowMs,
    side: zone.side,
    setupType: zone.setupType,
    state,
    entryZoneLow: zone.entryZoneLow,
    entryZoneHigh: zone.entryZoneHigh,
    exactEntry: zone.exactEntry,
    stop: zone.stop,
    tp1: zone.tp1,
    tp2: zone.tp2,
    score: zone.zoneScore,
    entered: zone.entered,
    reason,
  };
}

function targetReachedWithoutEntry(zone: AdaptiveZone, price: number) {
  if (zone.entered) return false;
  return zone.side === "BUY" ? price >= zone.tp1 : price <= zone.tp1;
}

function invalidated(zone: AdaptiveZone, price: number) {
  return zone.side === "BUY" ? price <= zone.stop : price >= zone.stop;
}

function tooFar(zone: AdaptiveZone, price: number, pipSize: number) {
  const d = Math.abs(price - zoneMid(zone));
  const risk = Math.max(Math.abs(zone.exactEntry - zone.stop), pipSize * 4);
  return d > risk * 1.9;
}

function materiallyDifferent(current: AdaptiveZone, candidate: AdaptiveZone, pipSize: number) {
  if (current.side !== candidate.side) return true;
  const driftPips = Math.abs(zoneMid(current) - zoneMid(candidate)) / Math.max(pipSize, 0.0001);
  return driftPips >= 5 || current.structureVersion !== candidate.structureVersion;
}

export function evaluateAdaptiveZone(
  current: AdaptiveZone | null,
  candidate: AdaptiveZone,
  price: number,
  nowMs: number,
  config: AccountConfig,
): ZoneEvaluation {
  if (!current) return { zone: updateZoneHot(candidate, price, nowMs, config.pipSize), archived: null, replaced: true };

  if (targetReachedWithoutEntry(current, price)) {
    const a = archive(current, "TP1_REACHED_WITHOUT_ENTRY", "TP1 reached before the old entry zone was touched; old opportunity retired", nowMs);
    return { zone: updateZoneHot(candidate, price, nowMs, config.pipSize), archived: a, replaced: true };
  }

  const tp1AfterEntry = current.entered && (current.side === "BUY" ? price >= current.tp1 : price <= current.tp1);
  if (tp1AfterEntry) {
    const a = archive(current, "REPLACED", "Triggered setup reached TP1; map the next best opportunity instead of recycling the old zone", nowMs);
    return { zone: updateZoneHot(candidate, price, nowMs, config.pipSize), archived: a, replaced: true };
  }

  if (invalidated(current, price)) {
    const a = archive(current, "INVALIDATED", "Price crossed structural invalidation before a valid execution", nowMs);
    return { zone: updateZoneHot(candidate, price, nowMs, config.pipSize), archived: a, replaced: true };
  }

  const stale = nowMs - current.createdAt >= ZONE_STALE_MS;
  const displaced = tooFar(current, price, config.pipSize);
  const advantage = candidate.zoneScore - current.zoneScore;
  const canReplace = nowMs - current.updatedAt >= MIN_REMAP_INTERVAL_MS;
  const better = advantage >= MIN_REPLACEMENT_ADVANTAGE;
  const freshMapNeeded = stale || displaced || (materiallyDifferent(current, candidate, config.pipSize) && better);

  if (!current.entered && canReplace && freshMapNeeded) {
    const reason = stale ? "Zone freshness expired" : displaced ? "Price displaced too far from the old zone" : `New zone score advantage +${advantage}`;
    const a = archive(current, "REPLACED", reason, nowMs);
    return { zone: updateZoneHot(candidate, price, nowMs, config.pipSize), archived: a, replaced: true };
  }

  return { zone: updateZoneHot(current, price, nowMs, config.pipSize), archived: null, replaced: false };
}

export function computeComparablePerformance(frames: MarketFrames, config: AccountConfig): BacktestStats {
  return backtestTightScalp(frames, config, 180);
}

export function buildV8Predictions(frames: MarketFrames, zone: AdaptiveZone): HorizonPrediction[] {
  return buildPredictions(frames, zone).map((row) => ({
    ...row,
    action: row.alignment === "ALIGNED"
      ? zone.state === "TRIGGERED"
        ? `ENTER ${zone.side} NOW @ ${zone.exactEntry.toFixed(2)}`
        : `NEXT ${zone.side} ZONE @ ${zone.exactEntry.toFixed(2)}`
      : `${row.minutes}M BIAS ${row.bias} · conflict with active ${zone.side} zone`,
  }));
}

export function currentAction(zone: AdaptiveZone | null, isStale: boolean, streamLive: boolean) {
  if (!streamLive) return "MARKET CLOSED / CONNECTING";
  if (isStale) return "MARKET DATA STALE · DO NOT EXECUTE";
  if (!zone) return "SETUP RE-MAPPING";
  if (zone.state === "TRIGGERED") return `ENTER ${zone.side} NOW`;
  return `WAIT FOR ${zone.side} ZONE`;
}

export function riskRewardLabel(zone: AdaptiveZone | null) {
  if (!zone) return "—";
  return `1:${round2(zone.rr1)} / 1:${round2(zone.rr2)}`;
}
