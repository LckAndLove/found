import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addWatchlistItem,
  ApiRequestError,
  getFundDetail,
  getHealth,
  getIntraday,
  listWatchlist,
  removeWatchlistItem,
  searchFunds,
  type FundDetail,
  type FundSearchItem,
  type FundWatchlistItem,
  type HealthResponse,
  type IntradayResponse
} from "./api";
import { appConfig } from "./config";
import { IntradayChart, HistoryTrendChart } from "./SvgChart";
import "./styles.css";

type DetailState = {
  data: Record<string, FundDetail>;
  loadingCodes: Set<string>;
  errorByCode: Record<string, string>;
};

function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [watchlist, setWatchlist] = useState<FundWatchlistItem[]>([]);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  
  const [details, setDetails] = useState<DetailState>({
    data: {},
    loadingCodes: new Set(),
    errorByCode: {}
  });

  const [intradayData, setIntradayData] = useState<Record<string, IntradayResponse>>({});
  const [loadingIntraday, setLoadingIntraday] = useState<Set<string>>(new Set());

  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FundSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [initializing, setInitializing] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    Promise.all([getHealth(), listWatchlist()])
      .then(([healthData, watchlistData]) => {
        if (!mounted) {
          return;
        }

        setHealth(healthData);
        setWatchlist(watchlistData.items);
        setSelectedCode(watchlistData.items[0]?.code ?? null);
        
        watchlistData.items.forEach((item) => {
          void loadDetail(item.code);
          void loadIntraday(item.code);
        });
      })
      .catch((requestError: Error) => {
        if (mounted) {
          setError(formatError(requestError));
        }
      })
      .finally(() => {
        if (mounted) {
          setInitializing(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const keyword = query.trim();
    let cancelled = false;

    if (!keyword) {
      setSearchResults([]);
      setSearching(false);
      return () => {
        cancelled = true;
      };
    }

    const timer = window.setTimeout(() => {
      setSearching(true);
      searchFunds(keyword)
        .then((result) => {
          if (cancelled) {
            return;
          }

          setSearchResults(result.items.slice(0, appConfig.funds.searchResultLimit));
          setError(null);
        })
        .catch((requestError: Error) => {
          if (cancelled) {
            return;
          }

          setSearchResults([]);
          setError(formatError(requestError));
        })
        .finally(() => {
          if (cancelled) {
            return;
          }

          setSearching(false);
        });
    }, 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  // Load intraday on selectedCode change if not loaded yet
  useEffect(() => {
    if (selectedCode && !intradayData[selectedCode] && !loadingIntraday.has(selectedCode)) {
      void loadIntraday(selectedCode);
    }
  }, [selectedCode]);

  const selectedDetail = selectedCode ? details.data[selectedCode] : null;
  const selectedItem = selectedCode ? watchlist.find((item) => item.code === selectedCode) : null;
  const selectedIntraday = selectedCode ? intradayData[selectedCode] : null;
  const isSelectedIntradayLoading = selectedCode ? loadingIntraday.has(selectedCode) : false;

  async function loadDetail(code: string) {
    setDetails((current) => ({
      ...current,
      loadingCodes: new Set(current.loadingCodes).add(code),
      errorByCode: omitKey(current.errorByCode, code)
    }));

    try {
      const detail = await getFundDetail(code);
      setDetails((current) => ({
        data: { ...current.data, [code]: detail },
        loadingCodes: deleteFromSet(current.loadingCodes, code),
        errorByCode: omitKey(current.errorByCode, code)
      }));
    } catch (requestError) {
      setDetails((current) => ({
        ...current,
        loadingCodes: deleteFromSet(current.loadingCodes, code),
        errorByCode: { ...current.errorByCode, [code]: formatError(requestError) }
      }));
    }
  }

  async function loadIntraday(code: string) {
    setLoadingIntraday((current) => new Set(current).add(code));
    try {
      const data = await getIntraday(code);
      setIntradayData((current) => ({ ...current, [code]: data }));
    } catch {
      // Fallback silently on intraday load failures
    } finally {
      setLoadingIntraday((current) => deleteFromSet(current, code));
    }
  }

  async function addFund(fund: FundSearchItem) {
    try {
      const item = await addWatchlistItem({ code: fund.code, name: fund.name });
      setWatchlist((current) => upsertWatchlist(current, item));
      setSelectedCode(item.code);
      setMessage(`已添加 ${fund.name}`);
      setQuery("");
      setSearchResults([]);
      
      // Load both detail and intraday
      await Promise.all([
        loadDetail(item.code),
        loadIntraday(item.code)
      ]);
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  async function removeFund(code: string) {
    try {
      await removeWatchlistItem(code);
      setWatchlist((current) => current.filter((item) => item.code !== code));
      setDetails((current) => ({
        data: omitKey(current.data, code),
        loadingCodes: deleteFromSet(current.loadingCodes, code),
        errorByCode: omitKey(current.errorByCode, code)
      }));
      setIntradayData((current) => omitKey(current, code));
      setSelectedCode((current) => (current === code ? watchlist.find((item) => item.code !== code)?.code ?? null : current));
      setMessage("已从自选列表中移除");
      setTimeout(() => setMessage(null), 3000);
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  return (
    <main className="app-shell">
      <section className="app-card">
        <header className="topbar">
          <div>
            <p className="eyebrow">{appConfig.app.name}</p>
            <h1>基金自选</h1>
          </div>
          <span className="status" data-ok={health?.ok ? "true" : "false"}>
            {health?.ok ? "服务已连接" : initializing ? "服务连接中..." : "服务连接失败"}
          </span>
        </header>

        <div className="search-box">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索基金代码、名称或简拼..." />
          {query.trim() ? (
            <div className="results">
              {searching ? <p>正在搜索...</p> : null}
              {!searching && searchResults.length === 0 ? <p>未搜到相关基金</p> : null}
              {searchResults.map((fund) => {
                const added = watchlist.some((item) => item.code === fund.code);
                return (
                  <button key={fund.code} onClick={() => void addFund(fund)} disabled={added}>
                    <span>{fund.name}</span>
                    <small>{added ? "已添加" : fund.code}</small>
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {message ? <p className="notice">{message}</p> : null}
        {error ? <p className="error">{error}</p> : null}

        <div className="content">
          <aside className="fund-list">
            {watchlist.length === 0 ? <p className="empty">您的自选列表为空</p> : null}
            {watchlist.map((item) => {
              const detail = details.data[item.code];
              const rate = detail?.gszzl ?? detail?.zzl;
              const rateClass = getRateClass(rate);
              return (
                <button
                  className="fund-row"
                  data-active={selectedCode === item.code ? "true" : "false"}
                  key={item.code}
                  onClick={() => setSelectedCode(item.code)}
                >
                  <span>{detail?.name ?? item.name ?? item.code}</span>
                  <strong className={rateClass}>{formatRate(rate)}</strong>
                </button>
              );
            })}
          </aside>

          <FundSummary
            code={selectedCode}
            detail={selectedDetail}
            intraday={selectedIntraday}
            loadingIntraday={isSelectedIntradayLoading}
            fallbackName={selectedItem?.name ?? selectedCode ?? ""}
            loading={selectedCode ? details.loadingCodes.has(selectedCode) : false}
            error={selectedCode ? details.errorByCode[selectedCode] : undefined}
            onRefresh={selectedCode ? () => { void loadDetail(selectedCode); void loadIntraday(selectedCode); } : undefined}
            onRemove={selectedCode ? () => void removeFund(selectedCode) : undefined}
          />
        </div>
      </section>
    </main>
  );
}

function FundSummarySkeleton() {
  return (
    <section className="summary">
      <div className="summary-head" style={{ marginBottom: "16px" }}>
        <div style={{ flex: 1 }}>
          <div className="skeleton skeleton-text" style={{ width: "60px", height: "14px" }}></div>
          <div className="skeleton skeleton-title" style={{ width: "65%", height: "24px", marginTop: "8px" }}></div>
        </div>
        <div className="skeleton skeleton-badge" style={{ width: "85px", height: "36px" }}></div>
      </div>

      <div className="values" style={{ marginBottom: "20px" }}>
        <div className="skeleton skeleton-card" style={{ height: "76px" }}></div>
        <div className="skeleton skeleton-card" style={{ height: "76px" }}></div>
        <div className="skeleton skeleton-card" style={{ height: "76px" }}></div>
      </div>

      <div className="tabs-header" style={{ marginBottom: "16px", paddingBottom: "8px" }}>
        <div className="skeleton skeleton-text" style={{ width: "80px", height: "18px", display: "inline-block", marginRight: "16px" }}></div>
        <div className="skeleton skeleton-text" style={{ width: "80px", height: "18px", display: "inline-block" }}></div>
      </div>

      <div className="skeleton skeleton-chart"></div>

      <div className="actions" style={{ marginTop: "auto" }}>
        <div className="skeleton" style={{ width: "76px", height: "36px", borderRadius: "8px" }}></div>
        <div className="skeleton" style={{ width: "76px", height: "36px", borderRadius: "8px" }}></div>
      </div>
    </section>
  );
}

function FundSummary(props: {
  code: string | null;
  detail: FundDetail | null;
  intraday: IntradayResponse | null;
  loadingIntraday: boolean;
  fallbackName: string;
  loading: boolean;
  error?: string;
  onRefresh?: () => void;
  onRemove?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"trends" | "holdings">("trends");

  // Keep active tab state reset on fund code change
  useEffect(() => {
    setActiveTab("trends");
  }, [props.code]);

  if (!props.code) {
    return (
      <section className="summary empty-summary">
        <h2>选择一只基金</h2>
        <p>在左侧列表中选择，或在上方搜索并添加一只自选基金，这里会展示高级图表和持仓明细。</p>
      </section>
    );
  }

  // Display skeleton if loading and we do not have cached details
  if (props.loading && !props.detail) {
    return <FundSummarySkeleton />;
  }

  const detail = props.detail;
  const rate = detail?.gszzl ?? detail?.zzl;
  const rateClass = getRateClass(rate);

  return (
    <section className="summary">
      <div className="summary-head">
        <div>
          <small>{props.code}</small>
          <h2>{detail?.name ?? props.fallbackName}</h2>
        </div>
        <strong className={`rate-badge ${rateClass}`}>
          {props.loading ? "更新中" : formatRate(rate)}
        </strong>
      </div>

      {props.error ? <p className="error">{props.error}</p> : null}

      <dl className="values">
        <div>
          <dt>单位净值</dt>
          <dd>{detail?.dwjz ?? "--"}</dd>
        </div>
        <div>
          <dt>估算净值</dt>
          <dd>{detail?.gsz ?? "--"}</dd>
        </div>
        <div>
          <dt>数据时间/净值日</dt>
          <dd>{detail?.gztime ?? detail?.jzrq ?? "--"}</dd>
        </div>
      </dl>

      {detail && (
        <>
          <div className="tabs-header">
            <button
              className="tab-btn"
              data-active={activeTab === "trends" ? "true" : "false"}
              onClick={() => setActiveTab("trends")}
            >
              走势分析
            </button>
            <button
              className="tab-btn"
              data-active={activeTab === "holdings" ? "true" : "false"}
              onClick={() => setActiveTab("holdings")}
            >
              持仓明细
            </button>
          </div>

          <div className="tab-content">
            {activeTab === "trends" ? (
              <>
                {props.loadingIntraday && !props.intraday ? (
                  <div className="skeleton skeleton-chart"></div>
                ) : (
                  <IntradayChart data={props.intraday?.items ?? []} />
                )}
                <HistoryTrendChart data={detail.historyTrend} />
              </>
            ) : (
              <div className="holdings-panel">
                <div className="holdings-header">
                  <span>重仓持股</span>
                  <span>占比</span>
                  <span style={{ textAlign: "right" }}>当日涨跌</span>
                </div>
                {detail.holdings.length === 0 ? (
                  <p className="empty" style={{ background: "#fbfcfa", border: "1px dashed var(--border-color)", borderRadius: "12px" }}>
                    暂无持股明细数据
                  </p>
                ) : (
                  detail.holdings.map((holding) => {
                    const weightNum = parseFloat(holding.weight);
                    const changeClass = getRateClass(holding.change);
                    return (
                      <div className="holding-row" key={holding.code}>
                        <div className="holding-meta">
                          <span className="name">{holding.name}</span>
                          <span className="code">{holding.code}</span>
                        </div>
                        <div className="holding-weight">
                          <span>{holding.weight}</span>
                          <div className="weight-bar-bg">
                            <div
                              className="weight-bar-fill"
                              style={{ width: `${Math.min(100, (weightNum || 0) * 6)}%` }}
                            ></div>
                          </div>
                        </div>
                        <span className={`holding-change ${changeClass}`}>
                          {holding.change !== null ? formatRate(holding.change) : "--"}
                        </span>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </>
      )}

      <div className="actions">
        <button onClick={props.onRefresh} disabled={props.loading}>
          {props.loading ? "正在刷新" : "手动刷新"}
        </button>
        <button className="danger" onClick={props.onRemove}>
          移除基金
        </button>
      </div>
    </section>
  );
}

function getRateClass(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === "") return "flat";
  const numeric = typeof value === "number" ? value : parseFloat(String(value));
  if (!Number.isFinite(numeric) || numeric === 0) return "flat";
  return numeric > 0 ? "up" : "down";
}

function formatRate(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return "--";
  }

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return String(value);
  }

  return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}%`;
}

function formatError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return error.message;
  }

  return error instanceof Error ? error.message : "请求失败";
}

function upsertWatchlist(items: FundWatchlistItem[], item: FundWatchlistItem) {
  const exists = items.some((current) => current.code === item.code);
  if (exists) {
    return items.map((current) => (current.code === item.code ? item : current));
  }

  return [...items, item];
}

function omitKey<T>(record: Record<string, T>, key: string) {
  const next = { ...record };
  delete next[key];
  return next;
}

function deleteFromSet<T>(set: Set<T>, value: T) {
  const next = new Set(set);
  next.delete(value);
  return next;
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("未找到页面根节点");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
);
