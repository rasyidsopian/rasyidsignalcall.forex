"use client";

import { useEffect, useRef } from "react";
import {
  ColorType,
  LineStyle,
  createChart,
  type CandlestickData,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import type { Candle } from "../types";
import type { TradeSetup } from "../lib/strategyV7";

const WIB_TIME = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});
const WIB_TICK = new Intl.DateTimeFormat("id-ID", {
  timeZone: "Asia/Jakarta",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function timeToDate(time: any) {
  if (typeof time === "number") return new Date(time * 1000);
  if (typeof time === "string") return new Date(time);
  if (time && typeof time === "object" && "year" in time) return new Date(Date.UTC(time.year, time.month - 1, time.day));
  return new Date();
}

function valid(c: Candle) {
  const ts = new Date(c.timestamp).getTime();
  return Number.isFinite(ts) && ts > 0 && [c.open, c.high, c.low, c.close].every(Number.isFinite) && c.high >= c.low;
}

function toPoint(c: Candle): CandlestickData<UTCTimestamp> {
  return {
    time: Math.floor(new Date(c.timestamp).getTime() / 1000) as UTCTimestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  };
}

function fullData(candles: Candle[]) {
  const map = new Map<number, Candle>();
  for (const c of candles.slice(-720)) {
    if (!valid(c)) continue;
    map.set(Math.floor(new Date(c.timestamp).getTime() / 1000), c);
  }
  return [...map.entries()].sort(([a], [b]) => a - b).map(([, c]) => toPoint(c));
}

type Props = {
  candles: Candle[];
  scalp: TradeSetup | null;
  daily: TradeSetup | null;
};

export default function CandleChart({ candles, scalp, daily }: Props) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const chartHostRef = useRef<HTMLDivElement | null>(null);
  const scalpZoneRef = useRef<HTMLDivElement | null>(null);
  const dailyZoneRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const priceLinesRef = useRef<IPriceLine[]>([]);
  const lastTimeRef = useRef<number | null>(null);
  const lastLengthRef = useRef(0);
  const initializedRef = useRef(false);
  const setupsRef = useRef<{ scalp: TradeSetup | null; daily: TradeSetup | null }>({ scalp: null, daily: null });

  const updateZones = () => {
    const series = seriesRef.current;
    if (!series) return;
    const apply = (el: HTMLDivElement | null, setup: TradeSetup | null) => {
      if (!el || !setup) {
        if (el) el.style.display = "none";
        return;
      }
      const yHigh = series.priceToCoordinate(setup.entryZoneHigh);
      const yLow = series.priceToCoordinate(setup.entryZoneLow);
      if (yHigh == null || yLow == null || !Number.isFinite(yHigh) || !Number.isFinite(yLow)) {
        el.style.display = "none";
        return;
      }
      const top = Math.min(yHigh, yLow);
      const height = Math.max(5, Math.abs(yLow - yHigh));
      el.style.display = "block";
      el.style.top = `${top}px`;
      el.style.height = `${height}px`;
      el.dataset.side = setup.side.toLowerCase();
      el.dataset.action = setup.predictiveAction === "ENTER_NOW" ? "live" : "wait";
      const label = el.querySelector("span");
      if (label) label.textContent = `${setup.kind} ${setup.side} ZONE ${setup.entryZoneLow.toFixed(2)}–${setup.entryZoneHigh.toFixed(2)}`;
    };
    apply(scalpZoneRef.current, setupsRef.current.scalp);
    apply(dailyZoneRef.current, setupsRef.current.daily);
  };

  const rebuildPriceLines = () => {
    const series = seriesRef.current;
    if (!series) return;
    for (const line of priceLinesRef.current) {
      try { series.removePriceLine(line); } catch {}
    }
    priceLinesRef.current = [];
    const add = (setup: TradeSetup | null, prefix: string, thin = false) => {
      if (!setup) return;
      const sideColor = setup.side === "BUY" ? "#19c37d" : "#ef4f5f";
      const lines = [
        { price: setup.exactEntry, title: `${prefix} ENTRY`, color: sideColor, style: LineStyle.Solid, width: thin ? 1 : 2 },
        { price: setup.stop, title: `${prefix} SL`, color: "#ff7b88", style: LineStyle.Dashed, width: 1 },
        { price: setup.tp1, title: `${prefix} TP1`, color: "#e9b949", style: LineStyle.Dotted, width: 1 },
        { price: setup.tp2, title: `${prefix} TP2`, color: "#b9c7e2", style: LineStyle.Dotted, width: 1 },
      ];
      for (const row of lines) {
        priceLinesRef.current.push(series.createPriceLine({
          price: row.price,
          color: row.color,
          lineWidth: row.width as 1 | 2 | 3 | 4,
          lineStyle: row.style,
          axisLabelVisible: true,
          title: row.title,
        }));
      }
    };
    add(setupsRef.current.daily, "D", true);
    add(setupsRef.current.scalp, "S", false);
  };

  useEffect(() => {
    if (!chartHostRef.current) return;
    const chart = createChart(chartHostRef.current, {
      height: 420,
      layout: { background: { type: ColorType.Solid, color: "#0b1020" }, textColor: "#9ba7bd" },
      localization: { timeFormatter: (time: any) => `${WIB_TIME.format(timeToDate(time))} WIB` },
      grid: { vertLines: { color: "#182035" }, horzLines: { color: "#182035" } },
      rightPriceScale: { borderColor: "#25304a", autoScale: true },
      timeScale: {
        borderColor: "#25304a",
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 4,
        barSpacing: 6,
        tickMarkFormatter: (time: any) => WIB_TICK.format(timeToDate(time)),
      },
    });
    const series = chart.addCandlestickSeries({
      upColor: "#19c37d", downColor: "#ef4f5f", borderVisible: false,
      wickUpColor: "#19c37d", wickDownColor: "#ef4f5f", priceLineVisible: true, lastValueVisible: true,
    });
    chartRef.current = chart;
    seriesRef.current = series;

    const resize = () => {
      const width = chartHostRef.current?.clientWidth ?? 800;
      if (width > 0) chart.applyOptions({ width });
      requestAnimationFrame(updateZones);
    };
    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(chartHostRef.current);
    window.addEventListener("resize", resize);
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => requestAnimationFrame(updateZones));
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      initializedRef.current = false;
      lastTimeRef.current = null;
      lastLengthRef.current = 0;
      priceLinesRef.current = [];
    };
  }, []);

  useEffect(() => {
    setupsRef.current = { scalp, daily };
    rebuildPriceLines();
    requestAnimationFrame(updateZones);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scalp?.entryZoneLow, scalp?.entryZoneHigh, scalp?.exactEntry, scalp?.stop, scalp?.tp1, scalp?.tp2, scalp?.side, daily?.entryZoneLow, daily?.entryZoneHigh, daily?.exactEntry, daily?.stop, daily?.tp1, daily?.tp2, daily?.side]);

  useEffect(() => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || candles.length === 0) return;
    const last = candles.at(-1)!;
    if (!valid(last)) return;
    const lastTime = Math.floor(new Date(last.timestamp).getTime() / 1000);
    const structureChanged = !initializedRef.current || candles.length !== lastLengthRef.current || lastTimeRef.current !== lastTime;

    try {
      if (structureChanged) {
        const data = fullData(candles);
        if (!data.length) return;
        series.setData(data);
        initializedRef.current = true;
        chart.timeScale().scrollToRealTime();
      } else {
        // V7 hot path: exactly one current-candle update per received provider event.
        series.update(toPoint(last));
      }
    } catch {
      try { series.setData(fullData(candles)); chart.timeScale().scrollToRealTime(); } catch {}
    }

    lastTimeRef.current = lastTime;
    lastLengthRef.current = candles.length;
    requestAnimationFrame(updateZones);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles]);

  return (
    <div ref={shellRef} className="chart-shell" aria-label="Realtime XAU/USD one-minute chart with scalp and daily mapped entry zones">
      <div ref={chartHostRef} className="chart" />
      <div ref={dailyZoneRef} className="entry-zone-box daily-zone"><span /></div>
      <div ref={scalpZoneRef} className="entry-zone-box scalp-zone"><span /></div>
    </div>
  );
}
