import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  addWatchlistItem,
  ApiRequestError,
  getFundDetail,
  getHealth,
  listWatchlist,
  removeWatchlistItem,
  searchFunds,
  type FundDetail,
  type FundSearchItem,
  type FundWatchlistItem,
  type HealthResponse
} from "./api";
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
    if (keyword.length === 0) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setSearching(true);
      searchFunds(keyword)
        .then((result) => {
          setSearchResults(result.items.slice(0, 8));
          setError(null);
        })
        .catch((requestError: Error) => {
          setSearchResults([]);
          setError(formatError(requestError));
        })
        .finally(() => {
          setSearching(false);
        });
    }, 280);

    return () => window.clearTimeout(timer);
  }, [query]);

  const selectedDetail = selectedCode ? details.data[selectedCode] : null;
  const selectedItem = selectedCode ? watchlist.find((item) => item.code === selectedCode) : null;
  const totalAssets = useMemo(() => {
    return watchlist.reduce((total, item) => total + (details.data[item.code] ? 1 : 0), 0);
  }, [details.data, watchlist]);

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

  async function addFund(fund: FundSearchItem) {
    try {
      const item = await addWatchlistItem({ code: fund.code, name: fund.name });
      setWatchlist((current) => upsertWatchlist(current, item));
      setSelectedCode(item.code);
      setMessage(`已添加 ${fund.name}`);
      setQuery("");
      setSearchResults([]);
      await loadDetail(item.code);
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
      setSelectedCode((current) => (current === code ? watchlist.find((item) => item.code !== code)?.code ?? null : current));
      setMessage("已从自选移除");
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">3.found</p>
          <h1>基金自选工作台</h1>
        </div>
        <div className="service-status" data-ok={health?.ok ? "true" : "false"}>
          <span>{health?.ok ? "后端已连接" : initializing ? "正在连接" : "后端异常"}</span>
          <strong>{health?.storage?.sqlite ? "SQLite 已启用" : "等待存储状态"}</strong>
        </div>
      </header>

      <section className="workspace">
        <aside className="sidebar" aria-label="基金自选列表">
          <div className="search-panel">
            <label htmlFor="fund-search">搜索基金</label>
            <input
              id="fund-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入代码或名称"
            />
            <div className="search-results">
              {searching ? <p className="muted">搜索中...</p> : null}
              {!searching && query.trim() && searchResults.length === 0 ? <p className="muted">未找到可添加基金</p> : null}
              {searchResults.map((fund) => {
                const added = watchlist.some((item) => item.code === fund.code);
                return (
                  <button className="search-result" key={fund.code} onClick={() => void addFund(fund)} disabled={added}>
                    <span>
                      <strong>{fund.name}</strong>
                      <small>{fund.code} · {fund.type ?? "基金"}</small>
                    </span>
                    <em>{added ? "已添加" : "添加"}</em>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="list-header">
            <span>自选基金</span>
            <strong>{watchlist.length}</strong>
          </div>

          <div className="watchlist">
            {watchlist.length === 0 ? (
              <div className="empty-state">
                <strong>暂无自选基金</strong>
                <span>使用上方搜索添加基金后，会自动保存到本地 SQLite。</span>
              </div>
            ) : null}

            {watchlist.map((item) => {
              const detail = details.data[item.code];
              const loading = details.loadingCodes.has(item.code);
              const active = selectedCode === item.code;
              return (
                <button
                  className="watchlist-item"
                  data-active={active ? "true" : "false"}
                  key={item.code}
                  onClick={() => setSelectedCode(item.code)}
                >
                  <span>
                    <strong>{detail?.name ?? item.name ?? item.code}</strong>
                    <small>{item.code}</small>
                  </span>
                  <em>{loading ? "更新中" : formatRate(detail?.gszzl ?? detail?.zzl)}</em>
                </button>
              );
            })}
          </div>
        </aside>

        <section className="detail-pane" aria-label="基金详情">
          <div className="summary-row">
            <Metric label="自选数量" value={String(watchlist.length)} />
            <Metric label="已加载详情" value={String(totalAssets)} />
            <Metric label="最近同步" value={health ? new Date(health.timestamp).toLocaleTimeString() : "--"} />
          </div>

          {message ? <p className="notice" onAnimationEnd={() => setMessage(null)}>{message}</p> : null}
          {error ? <p className="error-banner">{error}</p> : null}

          {!selectedCode ? (
            <div className="empty-detail">
              <h2>选择或添加一只基金</h2>
              <p>基金详情、持仓和近 90 日走势会显示在这里。</p>
            </div>
          ) : (
            <FundDetailView
              detail={selectedDetail}
              fallbackName={selectedItem?.name ?? selectedCode}
              code={selectedCode}
              loading={details.loadingCodes.has(selectedCode)}
              error={details.errorByCode[selectedCode]}
              onRefresh={() => void loadDetail(selectedCode)}
              onRemove={() => void removeFund(selectedCode)}
            />
          )}
        </section>
      </section>
    </main>
  );
}

function Metric(props: { label: string; value: string }) {
  return (
    <div className="metric">
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  );
}

function FundDetailView(props: {
  detail: FundDetail | null;
  fallbackName: string;
  code: string;
  loading: boolean;
  error?: string;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const detail = props.detail;
  const trend = detail?.historyTrend.slice(-28) ?? [];

  return (
    <article className="fund-detail">
      <div className="detail-header">
        <div>
          <p className="eyebrow">{props.code}</p>
          <h2>{detail?.name ?? props.fallbackName}</h2>
          <p className="muted">
            {detail?.noValuation ? "仅净值数据" : "实时估值"} · {detail?.gztime ?? detail?.jzrq ?? "等待数据"}
          </p>
        </div>
        <div className="actions">
          <button onClick={props.onRefresh} disabled={props.loading}>{props.loading ? "刷新中" : "刷新"}</button>
          <button className="danger" onClick={props.onRemove}>移除</button>
        </div>
      </div>

      {props.error ? <p className="error-banner">{props.error}</p> : null}

      <div className="value-grid">
        <Metric label="单位净值" value={detail?.dwjz ?? "--"} />
        <Metric label="估算净值" value={detail?.gsz ?? "--"} />
        <Metric label="涨跌幅" value={formatRate(detail?.gszzl ?? detail?.zzl)} />
        <Metric label="净值日期" value={detail?.jzrq ?? "--"} />
      </div>

      <section className="data-section">
        <div className="section-title">
          <h3>近 90 日走势</h3>
          <span>{trend.length > 0 ? `${trend.length} 个近期点` : "暂无走势"}</span>
        </div>
        <div className="trend-strip">
          {trend.length === 0 ? <span className="muted">暂无走势数据</span> : null}
          {trend.map((point) => (
            <i
              key={point.x}
              title={`${new Date(point.x).toLocaleDateString()} ${point.y}`}
              style={{ height: `${normalizeTrendHeight(point.y, trend)}%` }}
            />
          ))}
        </div>
      </section>

      <section className="data-section">
        <div className="section-title">
          <h3>前十大持仓</h3>
          <span>{detail?.holdings.length ?? 0} 项</span>
        </div>
        <div className="holding-table">
          {detail?.holdings.length ? (
            detail.holdings.map((holding) => (
              <div className="holding-row" key={`${holding.code}-${holding.name}`}>
                <span>
                  <strong>{holding.name || holding.code}</strong>
                  <small>{holding.code}</small>
                </span>
                <em>{holding.weight || "--"}</em>
                <b>{formatRate(holding.change)}</b>
              </div>
            ))
          ) : (
            <p className="muted">暂无持仓数据</p>
          )}
        </div>
      </section>
    </article>
  );
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

function normalizeTrendHeight(value: number, trend: FundDetail["historyTrend"]) {
  const values = trend.map((item) => item.y).filter((item) => Number.isFinite(item));
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max === min) {
    return 50;
  }

  return 18 + ((value - min) / (max - min)) * 74;
}

function formatError(error: unknown) {
  if (error instanceof ApiRequestError) {
    return `${error.message}${error.code ? ` (${error.code})` : ""}`;
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
