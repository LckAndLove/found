import { StrictMode, useEffect, useState } from "react";
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
import { appConfig } from "./config";
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

  const selectedDetail = selectedCode ? details.data[selectedCode] : null;
  const selectedItem = selectedCode ? watchlist.find((item) => item.code === selectedCode) : null;

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
      setMessage("已移除");
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
            {health?.ok ? "已连接" : initializing ? "连接中" : "连接失败"}
          </span>
        </header>

        <div className="search-box">
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索基金代码或名称" />
          {query.trim() ? (
            <div className="results">
              {searching ? <p>搜索中...</p> : null}
              {!searching && searchResults.length === 0 ? <p>暂无结果</p> : null}
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
            {watchlist.length === 0 ? <p className="empty">还没有自选基金</p> : null}
            {watchlist.map((item) => {
              const detail = details.data[item.code];
              return (
                <button
                  className="fund-row"
                  data-active={selectedCode === item.code ? "true" : "false"}
                  key={item.code}
                  onClick={() => setSelectedCode(item.code)}
                >
                  <span>{detail?.name ?? item.name ?? item.code}</span>
                  <strong>{formatRate(detail?.gszzl ?? detail?.zzl)}</strong>
                </button>
              );
            })}
          </aside>

          <FundSummary
            code={selectedCode}
            detail={selectedDetail}
            fallbackName={selectedItem?.name ?? selectedCode ?? ""}
            loading={selectedCode ? details.loadingCodes.has(selectedCode) : false}
            error={selectedCode ? details.errorByCode[selectedCode] : undefined}
            onRefresh={selectedCode ? () => void loadDetail(selectedCode) : undefined}
            onRemove={selectedCode ? () => void removeFund(selectedCode) : undefined}
          />
        </div>
      </section>
    </main>
  );
}

function FundSummary(props: {
  code: string | null;
  detail: FundDetail | null;
  fallbackName: string;
  loading: boolean;
  error?: string;
  onRefresh?: () => void;
  onRemove?: () => void;
}) {
  if (!props.code) {
    return (
      <section className="summary empty-summary">
        <h2>选择一只基金</h2>
        <p>搜索并添加基金后，这里会显示核心净值信息。</p>
      </section>
    );
  }

  const detail = props.detail;
  const rate = detail?.gszzl ?? detail?.zzl;

  return (
    <section className="summary">
      <div className="summary-head">
        <div>
          <small>{props.code}</small>
          <h2>{detail?.name ?? props.fallbackName}</h2>
        </div>
        <strong>{props.loading ? "更新中" : formatRate(rate)}</strong>
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
          <dt>日期</dt>
          <dd>{detail?.gztime ?? detail?.jzrq ?? "--"}</dd>
        </div>
      </dl>

      <div className="actions">
        <button onClick={props.onRefresh} disabled={props.loading}>{props.loading ? "刷新中" : "刷新"}</button>
        <button className="danger" onClick={props.onRemove}>移除</button>
      </div>
    </section>
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
