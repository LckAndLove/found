export type FundSearchItem = {
  code: string;
  name: string;
  shortName: string | null;
  type: string | null;
  category: string | number | null;
  categoryDesc: string | null;
  raw: Record<string, unknown>;
};

export type FundDetail = {
  code: string;
  name: string;
  dwjz: string | null;
  gsz: string | null;
  gztime: string | null;
  jzrq: string | null;
  gszzl: number | string | null;
  zzl: number | null;
  noValuation: boolean;
  holdings: FundHolding[];
  historyTrend: FundTrendPoint[];
  yesterdayChange: number | null;
  sgzt: string | null;
};

export type FundHolding = {
  code: string;
  name: string;
  weight: string;
  change: number | null;
};

export type FundTrendPoint = {
  x: number;
  y: number;
  equityReturn: number | null;
};

export type FundNetValue = {
  code: string;
  date: string;
  value: number | null;
};

export type SmartFundNetValue = {
  code: string;
  startDate: string;
  found: boolean;
  date: string | null;
  value: number | null;
};

export type IntradayPoint = {
  time: string;
  value: number;
  growth: string;
};

export type ReleaseInfo = {
  tagName: string;
  body: string;
};

export type FundWatchlistItem = {
  code: string;
  name: string | null;
  sortOrder: number;
  holdingShares: number | null;
  costPrice: number | null;
  createdAt: string;
  updatedAt: string;
};
