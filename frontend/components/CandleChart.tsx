"use client";

import { useEffect, useRef } from "react";
import { createChart, ColorType, type IChartApi, type UTCTimestamp } from "lightweight-charts";
import type { Candle } from "../types";

export default function CandleChart({ candles }: { candles: Candle[] }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current || candles.length === 0) return;
    let chart: IChartApi | null = createChart(ref.current, {
      height: 380,
      layout: {
        background: { type: ColorType.Solid, color: "#0b1020" },
        textColor: "#9ba7bd"
      },
      grid: {
        vertLines: { color: "#182035" },
        horzLines: { color: "#182035" }
      },
      rightPriceScale: { borderColor: "#25304a" },
      timeScale: { borderColor: "#25304a", timeVisible: true }
    });
    const series = chart.addCandlestickSeries({
      upColor: "#19c37d",
      downColor: "#ef4f5f",
      borderVisible: false,
      wickUpColor: "#19c37d",
      wickDownColor: "#ef4f5f"
    });
    series.setData(candles.map((c) => ({
      time: Math.floor(new Date(c.timestamp).getTime() / 1000) as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    })));
    chart.timeScale().fitContent();

    const resize = () => chart?.applyOptions({ width: ref.current?.clientWidth ?? 800 });
    resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart?.remove();
      chart = null;
    };
  }, [candles]);

  return <div ref={ref} className="chart" />;
}
