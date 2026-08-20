export type TimeframeAnalysis = {
  timeframe: string;
  bias: "BUY" | "SELL" | "NEUTRAL";
  score: number;
  rsi: number;
  adx: number;
  structure: string;
};

export type Signal = {
  symbol: string;
  signal: "BUY" | "SELL" | "NO_TRADE";
  confidence: number;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit_1: number | null;
  take_profit_2: number | null;
  risk_reward: number | null;
  market_regime: string;
  timestamp: string;
  status: string;
  reasons: string[];
  timeframe_analysis: TimeframeAnalysis[];
  strategy_name: string;
  strategy_version: string;
};

export type Candle = {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
