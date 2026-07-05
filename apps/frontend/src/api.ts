import { appConfig } from "./config";

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
  storage?: {
    sqlite?: boolean;
  };
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
  createdAt: string;
  updatedAt: string;
};

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

export function getApiBaseUrl() {
  return (
    window.foundConfig?.apiBaseUrl ??
    import.meta.env.VITE_API_BASE_URL ??
    `http://${appConfig.api.host}:${appConfig.api.port}`
  );
}

export async function getHealth() {
  return request<HealthResponse>("/api/health");
}

export async function searchFunds(keyword: string) {
  const params = new URLSearchParams({ keyword });
  return request<{ items: FundSearchItem[] }>(`/api/funds/search?${params.toString()}`);
}

export async function listWatchlist() {
  return request<{ items: FundWatchlistItem[] }>("/api/funds/watchlist");
}

export async function addWatchlistItem(input: { code: string; name?: string | null }) {
  return request<FundWatchlistItem>("/api/funds/watchlist", {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(input)
  });
}

export async function removeWatchlistItem(code: string) {
  await request<void>(`/api/funds/watchlist/${encodeURIComponent(code)}`, {
    method: "DELETE"
  });
}

export async function getFundDetail(code: string) {
  const params = new URLSearchParams({
    includeHoldings: "true",
    includeTrend: "true"
  });
  return request<FundDetail>(`/api/funds/${encodeURIComponent(code)}?${params.toString()}`);
}

export type IntradayResponse = {
  code: string;
  items: Array<{
    time: string;
    value: number;
    growth: string;
  }>;
};

export async function getIntraday(code: string) {
  return request<IntradayResponse>(`/api/funds/${encodeURIComponent(code)}/intraday`);
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, init);

  if (!response.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      body = null;
    }

    throw new ApiRequestError(
      response.status,
      body?.error?.code ?? "HTTP_ERROR",
      body?.error?.message ?? `请求失败：${response.status}`,
      body?.error?.details
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}
