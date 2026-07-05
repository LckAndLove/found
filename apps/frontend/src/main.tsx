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
  updateWatchlistItemHoldings,
  searchFunds,
  getMarketIndices,
  type FundDetail,
  type FundSearchItem,
  type FundWatchlistItem,
  type HealthResponse,
  type IntradayResponse,
  type MarketIndex
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
  const [editingCode, setEditingCode] = useState<string | null>(null);
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  
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

  // Auto-refresh interval (60 seconds, active only during China stock market trading hours)
  useEffect(() => {
    if (watchlist.length === 0) {
      return;
    }

    const interval = setInterval(() => {
      if (isTradingTime()) {
        watchlist.forEach((item) => {
          void loadDetail(item.code);
          void loadIntraday(item.code);
        });
      }
    }, 60000);

    return () => clearInterval(interval);
  }, [watchlist]);

  // Load market indices
  const loadIndices = () => {
    getMarketIndices()
      .then((data) => setIndices(data))
      .catch((err) => console.error("加载指数失败", err));
  };

  useEffect(() => {
    loadIndices();
    const interval = setInterval(() => {
      if (isTradingTime()) {
        loadIndices();
      }
    }, 60000);
    return () => clearInterval(interval);
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
      setEditingCode(item.code); // Auto focus and open the holdings editor
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
    const item = watchlist.find((i) => i.code === code);
    const hasShares = item && item.holdingShares && item.holdingShares > 0;
    if (hasShares) {
      const confirmed = window.confirm(
        `“${item.name || code}”已配置持仓数据，确定要将其从自选列表中移除吗？\n（此操作将永久清空该基金的持仓份额与成本数据）`
      );
      if (!confirmed) {
        return;
      }
    }

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
      setEditingCode(null);
      setMessage("已从自选列表中移除");
      setTimeout(() => setMessage(null), 3000);
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  async function saveHoldings(code: string, holdingShares: number | null, costPrice: number | null) {
    try {
      const updatedItem = await updateWatchlistItemHoldings(code, { holdingShares, costPrice });
      setWatchlist((current) =>
        current.map((item) =>
          item.code === code
            ? { ...item, holdingShares: updatedItem.holdingShares, costPrice: updatedItem.costPrice }
            : item
        )
      );
      setMessage("持仓与成本已保存");
      setTimeout(() => setMessage(null), 3000);
    } catch (requestError) {
      setError(formatError(requestError));
    }
  }

  // Portfolio calculations
  let totalValue = 0;
  let totalCost = 0;
  let totalTodayChange = 0;
  let hasHoldings = false;

  const todayIsTrading = isTradingDay();

  watchlist.forEach((item) => {
    const detail = details.data[item.code];
    const shares = item.holdingShares;
    if (shares && shares > 0) {
      hasHoldings = true;
      const dwjzVal = detail?.dwjz ? parseFloat(detail.dwjz) : 0;
      const gszVal = detail?.gsz ? parseFloat(detail.gsz) : dwjzVal;
      const costVal = item.costPrice || 0;

      const gszzl = typeof detail?.gszzl === "number" ? detail.gszzl : null;
      const estGsz = todayIsTrading
        ? (gszzl !== null ? dwjzVal * (1 + gszzl / 100) : gszVal)
        : dwjzVal;

      totalValue += shares * estGsz;
      totalCost += shares * costVal;
      
      if (todayIsTrading && detail) {
        const gszzl = typeof detail.gszzl === "number" ? detail.gszzl : null;
        if (gszzl !== null) {
          totalTodayChange += shares * dwjzVal * (gszzl / 100);
        } else if (detail.gsz) {
          const gszVal = parseFloat(detail.gsz);
          totalTodayChange += shares * (gszVal - dwjzVal);
        }
      }
    }
  });



  const totalGainLoss = totalValue - totalCost;
  const totalReturnRate = totalCost > 0 ? (totalGainLoss / totalCost) * 100 : 0;
  const yesterdayTotalValue = totalValue - totalTodayChange;
  const dailyChangeRate = yesterdayTotalValue > 0 ? (totalTodayChange / yesterdayTotalValue) * 100 : 0;

  return (
    <main className="app-shell">
      <div className="dashboard-container">
        <section className="app-card">
            {/* 1. Market Indices Bar */}
            <div className="market-indices-bar">
              {indices.map((idx, index) => {
                const changeClass = getRateClass(idx.change);
                return (
                  <div key={index} className="index-item">
                    <span className="index-name">{idx.name}</span>
                    <span className={`index-value ${changeClass}`}>{idx.value.toFixed(2)}</span>
                    <div className="index-change-row">
                      <span className={changeClass}>{idx.change > 0 ? "+" : ""}{idx.change.toFixed(2)}</span>
                      <span className={changeClass}>{idx.ratio > 0 ? "+" : ""}{idx.ratio.toFixed(2)}%</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {message ? <p className="notice">{message}</p> : null}
            {error ? <p className="error">{error}</p> : null}

            {/* 2. Fund Table */}
            <div className="fund-table-container">
              <table className="fund-monitor-table">
                <thead>
                  <tr>
                    <th style={{ maxWidth: "220px", width: "220px" }}>基金名称 ({watchlist.length})</th>
                    <th style={{ textAlign: "left" }}>代码</th>
                    <th style={{ textAlign: "right" }}>估算净值</th>
                    <th style={{ textAlign: "right" }}>成本</th>
                    <th style={{ textAlign: "right" }}>持仓份额</th>
                    <th style={{ textAlign: "right" }}>仓位占比</th>
                    <th style={{ textAlign: "right" }}>持有收益</th>
                    <th style={{ textAlign: "right" }}>持有收益率</th>
                    <th style={{ textAlign: "right" }}>涨跌幅</th>
                    <th style={{ textAlign: "right" }}>估算收益</th>
                    <th style={{ textAlign: "center" }}>更新时间</th>
                  </tr>
                </thead>
                <tbody>
                  {watchlist.map((item) => {
                    const detail = details.data[item.code];
                    const shares = item.holdingShares || 0;
                    const cost = item.costPrice || 0;
                    const dwjz = detail?.dwjz ? parseFloat(detail.dwjz) : 0;
                    const gszzlVal = detail?.gszzl !== null && detail?.gszzl !== undefined
                      ? (typeof detail.gszzl === "string" ? parseFloat(detail.gszzl) : detail.gszzl)
                      : null;
                    
                    const rate = todayIsTrading ? (gszzlVal ?? detail?.zzl) : detail?.zzl;
                    const rateClass = getRateClass(rate);
                    
                    const estGsz = todayIsTrading
                      ? (gszzlVal !== null ? dwjz * (1 + gszzlVal / 100) : (detail?.gsz ? parseFloat(detail.gsz) : dwjz))
                      : dwjz;
                      
                    const holdingProfit = shares * (dwjz - cost);
                    const holdingProfitRate = cost > 0 ? ((dwjz - cost) / cost) * 100 : 0;
                    
                    const estTodayProfit = todayIsTrading
                      ? (gszzlVal !== null ? shares * dwjz * (gszzlVal / 100) : (detail?.gsz ? shares * (parseFloat(detail.gsz) - dwjz) : 0))
                      : 0;
                      
                    const updateTime = detail?.gztime 
                      ? detail.gztime.split(" ")[0].slice(5) // e.g. "07-03"
                      : detail?.jzrq 
                      ? detail.jzrq.slice(5) 
                      : "--";

                    const positionValue = shares * estGsz;
                    const positionRatio = totalValue > 0 ? (positionValue / totalValue) * 100 : 0;

                    return (
                      <tr key={item.code}>
                        <td>
                          <div className="fund-name-cell">
                            <span className="fund-name">{detail?.name ?? item.name ?? "加载中..."}</span>
                            {isFundSuspended(item.code) && <span className="suspended-badge-sidebar">停申</span>}
                          </div>
                        </td>
                        <td className="flat font-number">{item.code}</td>
                        <td style={{ textAlign: "right" }} className="flat font-number">
                          {todayIsTrading ? (detail?.gsz ?? "--") : dwjz.toFixed(4)}
                        </td>
                        <td style={{ textAlign: "right" }} className="flat font-number">
                          {cost > 0 ? cost.toFixed(4) : "--"}
                        </td>
                        <td style={{ textAlign: "right" }} className="flat font-number">
                          {shares > 0 ? shares.toFixed(2) : "--"}
                        </td>
                        <td style={{ textAlign: "right" }} className="flat font-number">
                          {shares > 0 ? positionRatio.toFixed(2) + "%" : "--"}
                        </td>
                        <td style={{ textAlign: "right" }} className={`${getRateClass(holdingProfit)} font-number`}>
                          {holdingProfit > 0 ? "+" : ""}{holdingProfit.toFixed(2)}
                        </td>
                        <td style={{ textAlign: "right" }} className={`${getRateClass(holdingProfitRate)} font-number`}>
                          {holdingProfitRate > 0 ? "+" : ""}{holdingProfitRate.toFixed(2)}%
                        </td>
                        <td style={{ textAlign: "right" }} className={`${rateClass} font-number`}>
                          {formatRate(rate)}
                        </td>
                        <td style={{ textAlign: "right" }} className={`${getRateClass(estTodayProfit)} font-number`}>
                          {estTodayProfit > 0 ? "+" : ""}{estTodayProfit.toFixed(2)}
                        </td>
                        <td style={{ textAlign: "center" }} className="flat font-number">
                          {updateTime}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* 3. Summary Bottom Bar */}
            <div className="monitor-summary-bar">
              <div className="summary-item total-box">
                总金额:<span className="val-text">¥ {totalValue.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className={`summary-item today-box ${getRateClass(totalTodayChange)}`}>
                日收益:<span className={`val-text ${getRateClass(totalTodayChange)}`}>
                  {totalTodayChange > 0 ? "+" : ""}{totalTodayChange.toFixed(2)}({totalTodayChange >= 0 ? "+" : ""}{dailyChangeRate.toFixed(2)}%)
                </span>
              </div>
              <div className={`summary-item holding-box ${getRateClass(totalGainLoss)}`}>
                持有收益:<span className={`val-text ${getRateClass(totalGainLoss)}`}>
                  {totalGainLoss > 0 ? "+" : ""}{totalGainLoss.toFixed(2)}({totalReturnRate >= 0 ? "+" : ""}{totalReturnRate.toFixed(2)}%)
                </span>
              </div>

            </div>
        </section>
      </div>
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
  holdingShares: number | null;
  costPrice: number | null;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveHoldings?: (shares: number | null, cost: number | null) => Promise<void> | void;
  onRefresh?: () => void;
  onRemove?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"trends" | "holdings">("trends");
  const [editShares, setEditShares] = useState("");
  const [editCost, setEditCost] = useState("");

  // Sync inputs when props change
  useEffect(() => {
    setEditShares(props.holdingShares !== null ? String(props.holdingShares) : "");
    setEditCost(props.costPrice !== null ? String(props.costPrice) : "");
    setActiveTab("trends");
  }, [props.code, props.holdingShares, props.costPrice]);

  // Sync inputs when editing mode is toggled by parent
  useEffect(() => {
    if (props.isEditing) {
      setEditShares(props.holdingShares !== null ? String(props.holdingShares) : "");
      setEditCost(props.costPrice !== null ? String(props.costPrice) : "");
    }
  }, [props.isEditing]);

  if (!props.code) {
    return (
      <section className="summary empty-summary">
        <h2>选择一只基金</h2>
        <p>在左侧列表中选择，或在上方搜索并添加自选基金。支持输入您的持仓成本价和份额，实时查看个人资产盈亏。</p>
      </section>
    );
  }

  if (props.loading && !props.detail) {
    return <FundSummarySkeleton />;
  }

  const detail = props.detail;
  const todayIsTrading = isTradingDay();
  const rate = todayIsTrading ? (detail?.gszzl ?? detail?.zzl) : detail?.zzl;
  const rateClass = getRateClass(rate);

  // Calculations for current fund holdings
  const hasHoldings = props.holdingShares !== null && props.holdingShares > 0;
  const dwjzNum = detail?.dwjz ? parseFloat(detail.dwjz) : 0;
  const gszNum = detail?.gsz ? parseFloat(detail.gsz) : dwjzNum;
  const costNum = props.costPrice || 0;
  const sharesNum = props.holdingShares || 0;

  const currentValue = sharesNum * dwjzNum;
  
  // Resolve EastMoney stale gsz base price discrepancy using gszzl rate
  const gszzl = typeof detail?.gszzl === "number" ? detail.gszzl : null;
  const estGsz =
    todayIsTrading
      ? (gszzl !== null ? dwjzNum * (1 + gszzl / 100) : gszNum)
      : dwjzNum;

  const estCurrentValue = sharesNum * estGsz;
  const totalProfit = sharesNum * (dwjzNum - costNum);
  
  const estTodayProfit =
    todayIsTrading
      ? (gszzl !== null
          ? sharesNum * dwjzNum * (gszzl / 100)
          : detail?.gsz
          ? sharesNum * (gszNum - dwjzNum)
          : 0)
      : 0;

  const totalReturn = costNum > 0 ? (totalProfit / (sharesNum * costNum)) * 100 : 0;

  const handleSave = () => {
    const sharesVal = editShares.trim() === "" ? null : parseFloat(editShares);
    const costVal = editCost.trim() === "" ? null : parseFloat(editCost);
    
    if (props.onSaveHoldings) {
      props.onSaveHoldings(sharesVal, costVal);
    }
    props.onCancelEdit();
  };

  return (
    <section className="summary">
      <div className="summary-head">
        <div>
          <small>{props.code}</small>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
            <h2 style={{ margin: 0 }}>{detail?.name ?? props.fallbackName}</h2>
            {isFundSuspended(props.code) && (
              <span className="suspended-badge-detail">暂停申购</span>
            )}
          </div>
        </div>
        <strong className={`rate-badge ${rateClass}`}>
          {props.loading ? "更新中" : formatRate(rate)}
        </strong>
      </div>

      {props.error ? <p className="error">{props.error}</p> : null}

      {/* Grid: 6 cards if holds, 3 cards otherwise */}
      {hasHoldings ? (
        <dl className="values" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
          <div>
            <dt>单位净值</dt>
            <dd>{detail?.dwjz ?? "--"}</dd>
          </div>
          <div>
            <dt>估算净值</dt>
            <dd>{todayIsTrading ? (detail?.gsz ?? "--") : "--"}</dd>
          </div>
          <div>
            <dt>今日预估盈亏</dt>
            <dd className={getRateClass(estTodayProfit)}>
              {(detail?.gszzl !== null && detail?.gszzl !== undefined) || detail?.gsz
                ? `${estTodayProfit >= 0 ? "+" : ""}${estTodayProfit.toFixed(2)} 元`
                : "--"}
            </dd>
          </div>
          <div>
            <dt>当前持仓估值</dt>
            <dd>¥ {estCurrentValue.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</dd>
          </div>
          <div>
            <dt>持仓累计盈亏</dt>
            <dd className={getRateClass(totalProfit)}>
              {totalProfit >= 0 ? "+" : ""}{totalProfit.toFixed(2)} 元 ({totalReturn >= 0 ? "+" : ""}{totalReturn.toFixed(2)}%)
            </dd>
          </div>
          <div>
            <dt>持仓成本 (持有份额)</dt>
            <dd style={{ fontSize: "1.05rem" }}>
              {costNum.toFixed(4)} 元 ({sharesNum.toFixed(2)} 份)
            </dd>
          </div>
        </dl>
      ) : (
        <dl className="values">
          <div>
            <dt>单位净值</dt>
            <dd>{detail?.dwjz ?? "--"}</dd>
          </div>
          <div>
            <dt>估算净值</dt>
            <dd>{todayIsTrading ? (detail?.gsz ?? "--") : "--"}</dd>
          </div>
          <div>
            <dt>数据时间/净值日</dt>
            <dd>{detail?.gztime ?? detail?.jzrq ?? "--"}</dd>
          </div>
        </dl>
      )}

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
                  <IntradayChart data={props.intraday?.items ?? []} date={props.intraday?.date} />
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

      {/* Inline Holdings Editor Form */}
      {props.isEditing && (
        <div className="holdings-editor">
          <h3>编辑您的持仓数据</h3>
          <div className="holdings-editor-fields">
            <div className="editor-field">
              <label>持有份额 (份)</label>
              <input
                type="number"
                step="any"
                value={editShares}
                onChange={(e) => setEditShares(e.target.value)}
                placeholder="例如 2249.74"
              />
            </div>
            <div className="editor-field">
              <label>持仓成本价 (元)</label>
              <input
                type="number"
                step="any"
                value={editCost}
                onChange={(e) => setEditCost(e.target.value)}
                placeholder="例如 4.6222"
              />
            </div>
          </div>
          <div className="holdings-editor-actions">
            <button onClick={props.onCancelEdit}>取消</button>
            <button className="primary" onClick={handleSave}>保存</button>
          </div>
        </div>
      )}

      <div className="actions">
        {!props.isEditing && (
          <button onClick={props.onStartEdit} disabled={props.loading}>
            编辑持仓
          </button>
        )}
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

function isFundSuspended(code: string | null | undefined): boolean {
  return code === "012922" || code === "012920";
}

function isTradingDay(date: Date = new Date()): boolean {
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const findPart = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
  
  const year = findPart("year");
  const month = findPart("month");
  const day = findPart("day");
  
  const dayOfWeek = date.toLocaleString("en-US", { timeZone: "Asia/Shanghai", weekday: "short" });
  
  if (dayOfWeek === "Sat" || dayOfWeek === "Sun") {
    return false;
  }

  if (year === 2026) {
    const dateStr = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const holidays = [
      "01-01", "01-02",
      "02-16", "02-17", "02-18", "02-19", "02-20", "02-23",
      "04-06",
      "05-01", "05-04", "05-05",
      "06-19",
      "09-25",
      "10-01", "10-02", "10-05", "10-06", "10-07"
    ];
    if (holidays.includes(dateStr)) {
      return false;
    }
  }

  return true;
}

function isTradingTime(date: Date = new Date()): boolean {
  if (!isTradingDay(date)) {
    return false;
  }

  const formatter = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const findPart = (type: string) => parseInt(parts.find((p) => p.type === type)?.value || "0", 10);
  
  const hour = findPart("hour");
  const minute = findPart("minute");

  const timeInMinutes = hour * 60 + minute;
  const isMorning = timeInMinutes >= 9 * 60 + 30 && timeInMinutes <= 11 * 60 + 30;
  const isAfternoon = timeInMinutes >= 13 * 60 && timeInMinutes <= 15 * 60;
  
  return isMorning || isAfternoon;
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
