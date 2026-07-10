import { invoke } from "@tauri-apps/api/core";

export class ApiRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(status: number, code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ApiRequestError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type ApiErrorBody = {
  error?: {
    code?: string;
    message?: string;
    details?: Record<string, unknown>;
  };
};

export type HealthResponse = {
  ok: boolean;
  name: string;
  version?: string;
  service: string;
  timestamp: string;
};

export type FundSearchItem = {
  code: string;
  name: string;
  shortName: string | null;
  type: string | null;
  category: string | number | null;
  categoryDesc: string | null;
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

export type FundWatchlistItem = {
  code: string;
  name: string | null;
  sortOrder: number;
  holdingShares: number | null;
  costPrice: number | null;
  createdAt: string;
  updatedAt: string;
};

export type MarketIndex = {
  name: string;
  value: number;
  change: number;
  ratio: number;
};

export type MailFundItem = {
  code: string;
  name: string;
  nav: string;
  zzl: string;
  zzlRaw: number;
  dailyProfit: string | null;
  isSettled?: boolean;
};

export async function getHealth() {
  return invoke<HealthResponse>("get_health");
}

export async function searchFunds(keyword: string) {
  return invoke<{ items: FundSearchItem[] }>("search_funds", { keyword });
}

export async function listWatchlist() {
  const items = await invoke<FundWatchlistItem[]>("get_watchlist");
  return { items };
}

export async function addWatchlistItem(input: { code: string; name?: string | null }) {
  return invoke<FundWatchlistItem>("add_fund", {
    code: input.code,
    name: input.name ?? ""
  });
}

export async function removeWatchlistItem(code: string) {
  await invoke<void>("delete_fund", { code });
}

export async function updateWatchlistItemHoldings(code: string, input: { holdingShares: number | null; costPrice: number | null }) {
  return invoke<FundWatchlistItem>("update_fund_holdings", {
    code,
    holdingShares: input.holdingShares,
    costPrice: input.costPrice
  });
}

export async function getFundDetail(code: string) {
  return invoke<FundDetail>("get_fund_detail", { code });
}

export type IntradayResponse = {
  code: string;
  date: string | null;
  items: Array<{
    time: string;
    value: number;
    growth: string;
  }>;
};

export async function getIntraday(code: string) {
  return invoke<IntradayResponse>("get_fund_intraday", { code });
}

export async function getMarketIndices() {
  return invoke<MarketIndex[]>("get_market_indices");
}

export async function sendMailNotification(input: { subject?: string; funds?: MailFundItem[]; totalDailyProfit?: string }) {
  return invoke<{ ok: boolean; to: string; method?: string }>("send_mail_notification", {
    subject: input.subject ?? "",
    funds: input.funds ?? [],
    totalDailyProfit: input.totalDailyProfit ?? ""
  });
}
