export type Bias = "BUY" | "SELL" | "NEUTRAL";

export type TimeframeAnalysis = {
  timeframe: string;
  bias: Bias;
  score: number;
  directionalScore: number;
  rsi: number;
  adx: number;
  structure: string;
  emaState: string;
};

export type ExecutionMode = "ENTER_NOW" | "WAIT_PULLBACK";

export type Signal = {
  symbol: string;
  signal: "BUY" | "SELL";
  confidence: number;
  entry_price: number;
  stop_loss: number;
  take_profit_1: number;
  take_profit_2: number;
  risk_reward: number;
  market_regime: string;
  timestamp: string;
  status: string;
  execution_mode: ExecutionMode;
  setup_grade: "A" | "B" | "C";
  current_price: number;
  risk_distance: number;
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

export type BacktestTrade = {
  timestamp: string;
  side: "BUY" | "SELL";
  confidence: number;
  regime: string;
  result: "WIN" | "LOSS";
  riskReward: number;
};

export type BacktestStats = {
  winRate: number | null;
  wins: number;
  losses: number;
  sampleSize: number;
  profitFactor: number | null;
  averageRiskReward: number | null;
  trades: BacktestTrade[];
};
