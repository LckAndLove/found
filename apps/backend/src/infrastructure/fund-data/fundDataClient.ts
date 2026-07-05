import type {
  FundHolding,
  FundNetValue,
  FundSearchItem,
  FundTrendPoint,
  IntradayPoint
} from "../../domain/funds/types.js";
import type { UpstreamHttpClient } from "../http/upstreamHttpClient.js";
import {
  asRecord,
  escapeRegExp,
  extractTableCells,
  parseApidataContent,
  parseJsonp,
  parseNetWorthTrend,
  parseScriptVariable,
  toNullableString
} from "./parsers.js";

export type FundValuationSnapshot = {
  code: string;
  name: string;
  dwjz: string | null;
  gsz: string | null;
  gztime: string | null;
  jzrq: string | null;
  gszzl: number | string | null;
};

export type TencentFundQuote = {
  name: string;
  dwjz: string | null;
  zzl: number | null;
  jzrq: string | null;
};

export type FundHistoryTrend = {
  historyTrend: FundTrendPoint[];
  yesterdayChange: number | null;
};

export type FundDataClient = {
  searchFunds(keyword: string): Promise<FundSearchItem[]>;
  getValuation(code: string): Promise<FundValuationSnapshot | null>;
  getTencentFundQuote(code: string): Promise<TencentFundQuote | null>;
  getHoldings(code: string): Promise<FundHolding[]>;
  getHistoryTrend(code: string): Promise<FundHistoryTrend>;
  getNetValue(code: string, date: string): Promise<FundNetValue>;
  getNetValuesInRange(code: string, startDate: string, endDate: string, limit?: number): Promise<FundNetValue[]>;
  getIntraday(code: string): Promise<{ date: string | null; items: IntradayPoint[] }>;
  getShanghaiIndexDate(): Promise<string | null>;
  getMarketIndices(): Promise<Array<{ name: string; value: number; change: number; ratio: number }>>;
};

export function createFundDataClient(http: UpstreamHttpClient): FundDataClient {
  return {
    async searchFunds(keyword) {
      const callback = `SuggestData_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const url = new URL("https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx");
      url.searchParams.set("m", "1");
      url.searchParams.set("key", keyword);
      url.searchParams.set("callback", callback);
      url.searchParams.set("_", Date.now().toString());

      const payload = asRecord(parseJsonp(await http.getText(url), callback));
      const datas: unknown[] = Array.isArray(payload.Datas) ? payload.Datas : [];

      return datas
        .filter((item) => {
          const record = asRecord(item);
          return record.CATEGORY === 700 || record.CATEGORY === "700" || record.CATEGORYDESC === "基金";
        })
        .map((item) => {
          const record = asRecord(item);
          return {
            code: String(record.CODE ?? ""),
            name: String(record.NAME ?? record.SHORTNAME ?? ""),
            shortName: toNullableString(record.SHORTNAME),
            type: toNullableString(record.TYPE),
            category: typeof record.CATEGORY === "string" || typeof record.CATEGORY === "number" ? record.CATEGORY : null,
            categoryDesc: toNullableString(record.CATEGORYDESC),
            raw: record
          };
        })
        .filter((item) => item.code && item.name);
    },

    async getValuation(code) {
      try {
        const payload = asRecord(
          parseJsonp(await http.getText(`https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`), "jsonpgz")
        );
        const gszzlNumber = Number(payload.gszzl);

        return {
          code: String(payload.fundcode ?? code),
          name: String(payload.name ?? ""),
          dwjz: toNullableString(payload.dwjz),
          gsz: toNullableString(payload.gsz),
          gztime: toNullableString(payload.gztime),
          jzrq: toNullableString(payload.jzrq),
          gszzl: Number.isFinite(gszzlNumber) ? gszzlNumber : toNullableString(payload.gszzl)
        };
      } catch {
        return null;
      }
    },

    async getTencentFundQuote(code) {
      const raw = parseScriptVariable(await http.getText(`https://qt.gtimg.cn/q=jj${code}`), `v_jj${code}`);
      if (!raw) {
        return null;
      }

      const parts = raw.split("~");
      const zzl = Number.parseFloat(parts[7] ?? "");

      return {
        name: parts[1] || "",
        dwjz: parts[5] || null,
        zzl: Number.isFinite(zzl) ? zzl : null,
        jzrq: parts[8] ? parts[8].slice(0, 10) : null
      };
    },

    async getHoldings(code) {
      const url = new URL("https://fundf10.eastmoney.com/FundArchivesDatas.aspx");
      url.searchParams.set("type", "jjcc");
      url.searchParams.set("code", code);
      url.searchParams.set("topline", "10");
      url.searchParams.set("year", "");
      url.searchParams.set("month", "");
      url.searchParams.set("_", Date.now().toString());

      const html = parseApidataContent(await http.getText(url));
      if (!html) {
        return [];
      }

      const headerCells = extractTableCells(html.match(/<thead[\s\S]*?<\/thead>/i)?.[0] ?? "", "th");
      const indexes = resolveHoldingIndexes(headerCells);
      const tbody = html.match(/<tbody[\s\S]*?<\/tbody>/i)?.[0] ?? html;
      const rows = tbody.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
      const holdings = rows
        .map((row) => normalizeHoldingRow(extractTableCells(row, "td"), indexes))
        .filter((holding): holding is FundHolding => Boolean(holding))
        .slice(0, 10);

      return attachQuoteChanges(http, holdings);
    },

    async getHistoryTrend(code) {
      const trend = parseNetWorthTrend(await http.getText(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`));
      const historyTrend = trend.slice(-90).map((item) => ({
        x: Number(item.x),
        y: Number(item.y),
        equityReturn: typeof item.equityReturn === "number" ? item.equityReturn : null
      }));
      const previous = historyTrend.at(-2);

      return {
        historyTrend,
        yesterdayChange: previous?.equityReturn ?? null
      };
    },

    async getNetValue(code, date) {
      const url = new URL("https://fundf10.eastmoney.com/F10DataApi.aspx");
      url.searchParams.set("type", "lsjz");
      url.searchParams.set("code", code);
      url.searchParams.set("page", "1");
      url.searchParams.set("per", "1");
      url.searchParams.set("sdate", date);
      url.searchParams.set("edate", date);

      const content = parseApidataContent(await http.getText(url));
      if (!content || content.includes("暂无数据")) {
        return { code, date, value: null };
      }

      const row = content.split(/<tr[^>]*>/i).find((item) => item.includes(`<td>${date}</td>`));
      const cells = row?.match(/<td[^>]*>[\s\S]*?<\/td>/gi) ?? [];
      const valueText = cells[1]?.replace(/<[^>]+>/g, "").trim();
      const value = valueText ? Number.parseFloat(valueText) : Number.NaN;

      return {
        code,
        date,
        value: Number.isFinite(value) ? value : null
      };
    },

    async getIntraday(code) {
      type UpstreamIntraday = {
        code: number;
        data?: {
          data?: unknown[];
          yesterdayDwjz?: string | number;
          date?: string;
        };
      };

      const url = new URL("https://web.ifzq.gtimg.cn/fund/newfund/fundSsgz/getSsgz");
      url.searchParams.set("app", "web");
      url.searchParams.set("symbol", `jj${code}`);
      url.searchParams.set("_", Date.now().toString());

      const result = await http.getJson<UpstreamIntraday>(url);
      const list = Array.isArray(result.data?.data) ? result.data.data : [];
      const yesterdayDwjz = Number(result.data?.yesterdayDwjz);
      const date = result.data?.date ? String(result.data.date) : null;
      if (result.code !== 0 || !Number.isFinite(yesterdayDwjz) || yesterdayDwjz === 0) {
        return { date: null, items: [] };
      }

      const items = list
        .map((item) => {
          if (!Array.isArray(item)) {
            return null;
          }

          const time = String(item[0] ?? "");
          const value = Number(item[1]);
          if (time.length !== 4 || !Number.isFinite(value)) {
            return null;
          }

          return {
            time: `${time.slice(0, 2)}:${time.slice(2)}`,
            value,
            growth: (((value - yesterdayDwjz) / yesterdayDwjz) * 100).toFixed(2)
          };
        })
        .filter((item): item is IntradayPoint => Boolean(item));

      return { date, items };
    },

    async getShanghaiIndexDate() {
      const raw = parseScriptVariable(await http.getText(`https://qt.gtimg.cn/q=sh000001&_t=${Date.now()}`), "v_sh000001");
      const parts = raw?.split("~") ?? [];
      return parts[30] ? parts[30].slice(0, 8) : null;
    },

    async getMarketIndices() {
      const raw = await http.getText(`https://qt.gtimg.cn/q=s_sh000001,s_sz399300,s_sz399001,s_sz399006,s_sh688000&_t=${Date.now()}`);
      const lines = raw.split("\n").filter(Boolean);
      const indices = lines.map((line) => {
        const eqIdx = line.indexOf("=");
        if (eqIdx === -1) return null;
        const valStr = line.slice(eqIdx + 1).replace(/"/g, "").replace(/;/g, "").trim();
        const parts = valStr.split("~");
        if (parts.length < 5) return null;
        return {
          name: parts[1],
          value: parseFloat(parts[2]),
          change: parseFloat(parts[3]),
          ratio: parseFloat(parts[4])
        };
      }).filter((item): item is { name: string; value: number; change: number; ratio: number } => Boolean(item));
      return indices;
    },

    async getNetValuesInRange(code, startDate, endDate, limit = 40) {
      const url = new URL("https://fundf10.eastmoney.com/F10DataApi.aspx");
      url.searchParams.set("type", "lsjz");
      url.searchParams.set("code", code);
      url.searchParams.set("page", "1");
      url.searchParams.set("per", limit.toString());
      url.searchParams.set("sdate", startDate);
      url.searchParams.set("edate", endDate);

      const content = parseApidataContent(await http.getText(url));
      if (!content || content.includes("暂无数据")) {
        return [];
      }

      // Extract rows
      const tbodyMatch = content.match(/<tbody[\s\S]*?<\/tbody>/i);
      const tbody = tbodyMatch ? tbodyMatch[0] : content;
      const rows = tbody.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];

      const results: FundNetValue[] = [];
      for (const row of rows) {
        const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/gi) ?? [];
        if (cells.length < 2) continue;
        const cell0 = cells[0];
        const cell1 = cells[1];
        if (!cell0 || !cell1) continue;
        const dateText = cell0.replace(/<[^>]+>/g, "").trim();
        const valueText = cell1.replace(/<[^>]+>/g, "").trim();

        const value = valueText ? Number.parseFloat(valueText) : Number.NaN;
        results.push({
          code,
          date: dateText,
          value: Number.isFinite(value) ? value : null
        });
      }

      return results;
    }
  };
}

function resolveHoldingIndexes(headerCells: string[]) {
  let code = -1;
  let name = -1;
  let weight = -1;

  headerCells.forEach((header, index) => {
    const normalized = header.replace(/\s+/g, "");
    if (code < 0 && (normalized.includes("股票代码") || normalized.includes("证券代码"))) {
      code = index;
    }
    if (name < 0 && (normalized.includes("股票名称") || normalized.includes("证券名称"))) {
      name = index;
    }
    if (weight < 0 && (normalized.includes("占净值比例") || normalized.includes("占比"))) {
      weight = index;
    }
  });

  return { code, name, weight };
}

function normalizeHoldingRow(cells: string[], indexes: { code: number; name: number; weight: number }): FundHolding | null {
  if (cells.length === 0) {
    return null;
  }

  const code =
    indexes.code >= 0 ? cells[indexes.code]?.match(/(\d{5,6})/)?.[1] ?? "" : cells.find((cell) => /^\d{5,6}$/.test(cell)) ?? "";
  const name = indexes.name >= 0 ? cells[indexes.name] ?? "" : cells.find((cell) => cell && cell !== code && !/%$/.test(cell)) ?? "";
  const rawWeight = indexes.weight >= 0 ? cells[indexes.weight] ?? "" : cells.find((cell) => /\d+(?:\.\d+)?\s*%/.test(cell)) ?? "";
  const weight = rawWeight.match(/([\d.]+)\s*%/)?.[1];

  if (!code && !name && !weight) {
    return null;
  }

  return {
    code,
    name,
    weight: weight ? `${weight}%` : rawWeight,
    change: null
  };
}

async function attachQuoteChanges(http: UpstreamHttpClient, holdings: FundHolding[]) {
  const quoteSymbols = holdings
    .map((holding) => toTencentQuoteSymbol(holding.code))
    .filter((symbol): symbol is string => Boolean(symbol));

  if (quoteSymbols.length === 0) {
    return holdings;
  }

  try {
    const text = await http.getText(`https://qt.gtimg.cn/q=${quoteSymbols.join(",")}`);
    return holdings.map((holding) => {
      const symbol = toTencentQuoteSymbol(holding.code);
      if (!symbol) {
        return holding;
      }

      const raw = text.match(new RegExp(`v_${escapeRegExp(symbol)}="([\\s\\S]*?)";?`))?.[1];
      const change = Number.parseFloat(raw?.split("~")[5] ?? "");
      return {
        ...holding,
        change: Number.isFinite(change) ? change : holding.change
      };
    });
  } catch {
    return holdings;
  }
}

function toTencentQuoteSymbol(code: string) {
  if (/^\d{6}$/.test(code)) {
    if (code.startsWith("920") || code.startsWith("4") || code.startsWith("8")) {
      return `s_bj${code}`;
    }
    if (code.startsWith("6") || code.startsWith("9")) {
      return `s_sh${code}`;
    }
    return `s_sz${code}`;
  }

  if (/^\d{5}$/.test(code)) {
    return `s_hk${code}`;
  }

  return null;
}
