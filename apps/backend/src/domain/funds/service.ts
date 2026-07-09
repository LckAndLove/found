import type {
  FundDetail,
  FundNetValue,
  FundSearchItem,
  FundWatchlistItem,
  SmartFundNetValue
} from "./types.js";
import type { FundDataClient, FundValuationSnapshot, TencentFundQuote } from "../../infrastructure/fund-data/fundDataClient.js";
import type { FundWatchlistRepository } from "../../infrastructure/sqlite/fundWatchlistRepository.js";
import { NotFoundError, UpstreamError } from "../../shared/errors.js";

export type FundService = {
  searchFunds(keyword: string): Promise<FundSearchItem[]>;
  listWatchlist(): Promise<FundWatchlistItem[]>;
  upsertWatchlistItem(input: { code: string; name?: string | null }): Promise<FundWatchlistItem>;
  updateWatchlistItemHoldings(code: string, input: { holdingShares: number | null; costPrice: number | null }): Promise<FundWatchlistItem>;
  removeWatchlistItem(code: string): Promise<void>;
  getFundDetail(code: string, options?: { includeHoldings?: boolean; includeTrend?: boolean }): Promise<FundDetail>;
  getFundNetValue(code: string, date: string): Promise<FundNetValue>;
  getSmartFundNetValue(code: string, startDate: string, maxDays?: number): Promise<SmartFundNetValue>;
  getFundIntraday(code: string): Promise<{ code: string; date: string | null; items: Awaited<ReturnType<FundDataClient["getIntraday"]>>["items"] }>;
  getShanghaiIndexDate(): Promise<{ date: string | null }>;
  getMarketIndices(): Promise<Array<{ name: string; value: number; change: number; ratio: number }>>;
};

type FundHistoryTrend = Awaited<ReturnType<FundDataClient["getHistoryTrend"]>>;

export function createFundService(dataClient: FundDataClient, watchlistRepository: FundWatchlistRepository): FundService {
  return {
    searchFunds(keyword) {
      return dataClient.searchFunds(keyword);
    },

    async listWatchlist() {
      return watchlistRepository.list();
    },

    async upsertWatchlistItem(input) {
      return watchlistRepository.upsert(input);
    },

    async updateWatchlistItemHoldings(code, input) {
      return watchlistRepository.updateHoldings(code, input);
    },

    async removeWatchlistItem(code) {
      const removed = watchlistRepository.remove(code);
      if (!removed) {
        throw new NotFoundError("自选基金不存在", { code });
      }
    },

    async getFundDetail(code, options = {}) {
      const includeHoldings = options.includeHoldings ?? true;
      const includeTrend = options.includeTrend ?? true;
      const [valuationResult, fallbackResult, latestNetResult] = await Promise.allSettled([
        dataClient.getValuation(code),
        dataClient.getTencentFundQuote(code),
        dataClient.getLatestNetValue(code)
      ]);

      const valuation = fulfilledValue(valuationResult);
      const fallback = fulfilledValue(fallbackResult);
      const latestNet = fulfilledValue(latestNetResult);
      const primaryErrors = [rejectedReason(valuationResult), rejectedReason(fallbackResult)].filter(Boolean);

      if (!valuation && !fallback) {
        if (primaryErrors.length > 0) {
          throw normalizeUpstreamError(primaryErrors[0]);
        }

        throw new NotFoundError("未找到基金数据", { code });
      }

      const [holdings, trendData] = await Promise.all([
        includeHoldings ? dataClient.getHoldings(code).catch(() => []) : Promise.resolve([]),
        includeTrend
          ? dataClient.getHistoryTrend(code).catch(() => emptyHistoryTrend())
          : Promise.resolve(emptyHistoryTrend())
      ]);

      const detail = buildFundDetail(code, valuation, fallback, holdings, trendData);

      // 数据融合逻辑：选择日期最新（最靠近今天）的价格作为最终单位净值
      if (latestNet?.date && (!detail.jzrq || latestNet.date >= detail.jzrq)) {
        detail.dwjz = String(latestNet.value);
        detail.jzrq = latestNet.date;
      }

      if (fallback?.jzrq && (!detail.jzrq || fallback.jzrq >= detail.jzrq)) {
        detail.dwjz = fallback.dwjz;
        detail.jzrq = fallback.jzrq;
        detail.zzl = fallback.zzl;
      }

      return detail;
    },

    getFundNetValue(code, date) {
      return dataClient.getNetValue(code, date);
    },

    async getSmartFundNetValue(code, startDate, maxDays = 30) {
      const today = startOfUtcDay(new Date());
      const start = startOfUtcDay(new Date(`${startDate}T00:00:00.000Z`));
      const end = addUtcDays(start, maxDays - 1);
      const endDateStr = (end > today ? today : end).toISOString().slice(0, 10);

      // Single range query to avoid up to 30 sequential network requests
      const list = await dataClient.getNetValuesInRange(code, startDate, endDateStr, maxDays + 10);

      // Find the earliest date in chronological order (ascending) that has a valid value
      const sortedList = [...list]
        .filter((item) => item.value !== null)
        .sort((a, b) => a.date.localeCompare(b.date));

      if (sortedList.length > 0) {
        const match = sortedList[0];
        return {
          code,
          startDate,
          found: true,
          date: match.date,
          value: match.value
        };
      }

      return {
        code,
        startDate,
        found: false,
        date: null,
        value: null
      };
    },

    async getFundIntraday(code) {
      const result = await dataClient.getIntraday(code);
      return {
        code,
        date: result.date,
        items: result.items
      };
    },

    async getShanghaiIndexDate() {
      return {
        date: await dataClient.getShanghaiIndexDate()
      };
    },

    async getMarketIndices() {
      return dataClient.getMarketIndices();
    }
  };
}

function buildFundDetail(
  code: string,
  valuation: FundValuationSnapshot | null,
  fallback: TencentFundQuote | null,
  holdings: FundDetail["holdings"],
  trendData: FundHistoryTrend
): FundDetail {
  if (valuation) {
    return {
      code: valuation.code || code,
      name: valuation.name || fallback?.name || `未知基金(${code})`,
      dwjz: valuation.dwjz,
      gsz: valuation.gsz,
      gztime: valuation.gztime,
      jzrq: valuation.jzrq,
      gszzl: valuation.gszzl,
      zzl: null,
      noValuation: false,
      holdings,
      historyTrend: trendData.historyTrend,
      yesterdayChange: trendData.yesterdayChange
    };
  }

  return {
    code,
    name: fallback?.name || `未知基金(${code})`,
    dwjz: fallback?.dwjz ?? null,
    gsz: null,
    gztime: null,
    jzrq: fallback?.jzrq ?? null,
    gszzl: null,
    zzl: fallback?.zzl ?? null,
    noValuation: true,
    holdings,
    historyTrend: trendData.historyTrend,
    yesterdayChange: trendData.yesterdayChange
  };
}

function fulfilledValue<T>(result: PromiseSettledResult<T>) {
  return result.status === "fulfilled" ? result.value : null;
}

function rejectedReason<T>(result: PromiseSettledResult<T>) {
  return result.status === "rejected" ? result.reason : null;
}

function normalizeUpstreamError(error: unknown) {
  return error instanceof UpstreamError ? error : new UpstreamError("上游数据源请求失败", { reason: String(error) });
}

function emptyHistoryTrend(): FundHistoryTrend {
  return { historyTrend: [], yesterdayChange: null };
}

function startOfUtcDay(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
