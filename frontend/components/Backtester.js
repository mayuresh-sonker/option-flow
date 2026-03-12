import React, { useMemo, useState } from "react";
import axios from "axios";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const LOOKBACK_OPTIONS = [
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
  { label: "2Y", days: 730 },
];

const STRATEGY_OPTIONS = [
  { label: "Bull Call Spread", value: "bull_call_spread" },
];

const Backtester = () => {
  const [strategyType, setStrategyType] = useState("bull_call_spread");
  const [lookbackDays, setLookbackDays] = useState(365);
  const [ticker, setTicker] = useState("AAPL");
  const [deltaTarget, setDeltaTarget] = useState(0.3);
  const [daysToExpiry, setDaysToExpiry] = useState(30);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);

  const backendBaseUrl = "http://localhost:8000";

  const equityChartData = useMemo(() => {
    const trades = result?.results?.trades ?? [];
    const curve = result?.results?.equity_curve ?? [];
    if (!trades.length || !curve.length) return [];

    return curve.map((equity, idx) => ({
      i: idx + 1,
      date: trades[idx]?.expiry_date || trades[idx]?.entry_date || `${idx + 1}`,
      equity,
      cumReturnPct: (equity - 1) * 100,
    }));
  }, [result]);

  const stats = useMemo(() => {
    const r = result?.results;
    if (!r) return null;
    return {
      winRate: r.win_rate,
      avgReturnPct: r.avg_return_pct,
      sharpe: r.sharpe_ratio,
      maxDrawdown: r.max_drawdown,
    };
  }, [result]);

  const statTone = (key, value) => {
    if (value === null || value === undefined || Number.isNaN(value)) {
      return "text-slate-200";
    }
    if (key === "winRate") return value >= 0.55 ? "text-emerald-300" : "text-rose-300";
    if (key === "avgReturnPct") return value >= 0 ? "text-emerald-300" : "text-rose-300";
    if (key === "sharpe") return value >= 1 ? "text-emerald-300" : value >= 0 ? "text-amber-300" : "text-rose-300";
    if (key === "maxDrawdown") return value >= -0.1 ? "text-emerald-300" : value >= -0.25 ? "text-amber-300" : "text-rose-300";
    return "text-slate-200";
  };

  const formatPct = (v, decimals = 1) => {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return `${(v * 100).toFixed(decimals)}%`;
  };

  const formatPctAlready = (v, decimals = 2) => {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return `${Number(v).toFixed(decimals)}%`;
  };

  const formatNumber = (v, decimals = 2) => {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return Number(v).toFixed(decimals);
  };

  const formatMoney = (v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    const n = Number(v);
    return `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(0)}`;
  };

  const runBacktest = async () => {
    const t = ticker.trim().toUpperCase();
    if (!t) return;

    try {
      setError("");
      setLoading(true);
      setResult(null);

      const res = await axios.post(`${backendBaseUrl}/api/backtest`, {
        ticker: t,
        strategy_type: strategyType,
        lookback_days: lookbackDays,
        delta_target: Number(deltaTarget),
        days_to_expiry: Number(daysToExpiry),
      });

      setResult(res.data);
    } catch (err) {
      const detail =
        err?.response?.data?.detail ||
        err?.message ||
        "Unable to run backtest.";
      setError(String(detail));
    } finally {
      setLoading(false);
    }
  };

  const trades = result?.results?.trades ?? [];

  return (
    <div className="mt-8 space-y-4">
      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/40">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Backtester
            </div>
            <div className="text-[11px] text-slate-500">
              Click Run Backtest. This can take ~5–10 seconds.
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                Ticker
              </label>
              <input
                value={ticker}
                onChange={(e) => setTicker(e.target.value)}
                className="w-28 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm font-mono text-slate-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                Strategy
              </label>
              <select
                value={strategyType}
                onChange={(e) => setStrategyType(e.target.value)}
                className="w-48 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none focus:border-emerald-500"
              >
                {STRATEGY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                Lookback
              </label>
              <select
                value={lookbackDays}
                onChange={(e) => setLookbackDays(Number(e.target.value))}
                className="w-24 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100 outline-none focus:border-emerald-500"
              >
                {LOOKBACK_OPTIONS.map((o) => (
                  <option key={o.days} value={o.days}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                DTE
              </label>
              <input
                type="number"
                min={7}
                step={1}
                value={daysToExpiry}
                onChange={(e) => setDaysToExpiry(e.target.value)}
                className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm font-mono text-slate-100 outline-none focus:border-emerald-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-[10px] uppercase tracking-wide text-slate-500">
                Delta
              </label>
              <input
                type="number"
                min={0.05}
                max={0.95}
                step={0.01}
                value={deltaTarget}
                onChange={(e) => setDeltaTarget(e.target.value)}
                className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm font-mono text-slate-100 outline-none focus:border-emerald-500"
              />
            </div>
            <button
              type="button"
              onClick={runBacktest}
              disabled={loading}
              className="mt-1 inline-flex items-center justify-center rounded-md border border-emerald-500/60 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-300 shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60 sm:mt-0"
            >
              Run Backtest
            </button>
          </div>
        </div>

        {loading && (
          <div className="mt-3 flex items-center gap-2 text-xs text-slate-400">
            <span className="inline-flex h-3 w-3 animate-spin rounded-full border-[2px] border-emerald-400 border-t-transparent" />
            <span>Running backtest...</span>
          </div>
        )}

        {error && (
          <div className="mt-3 rounded-md border border-rose-500/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        {result?.note && (
          <div className="mt-3 rounded-md border border-slate-800 bg-slate-950/60 px-3 py-2 text-[11px] text-slate-400">
            {result.note}
          </div>
        )}
      </div>

      {/* Stat cards */}
      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/40">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              Win rate
            </div>
            <div className={`mt-1 text-2xl font-semibold ${statTone("winRate", stats.winRate)}`}>
              {formatPct(stats.winRate, 1)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/40">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              Avg return
            </div>
            <div className={`mt-1 text-2xl font-semibold ${statTone("avgReturnPct", stats.avgReturnPct)}`}>
              {formatPctAlready(stats.avgReturnPct, 2)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/40">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              Sharpe
            </div>
            <div className={`mt-1 text-2xl font-semibold ${statTone("sharpe", stats.sharpe)}`}>
              {formatNumber(stats.sharpe, 2)}
            </div>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/40">
            <div className="text-[11px] uppercase tracking-wide text-slate-500">
              Max drawdown
            </div>
            <div className={`mt-1 text-2xl font-semibold ${statTone("maxDrawdown", stats.maxDrawdown)}`}>
              {formatPct(stats.maxDrawdown, 1)}
            </div>
          </div>
        </div>
      )}

      {/* Equity curve */}
      {!!equityChartData.length && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/40">
          <div className="mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Equity Curve
            </div>
            <div className="text-[11px] text-slate-500">
              Cumulative return over backtested trades.
            </div>
          </div>
          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={equityChartData}
                margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
                <XAxis
                  dataKey="i"
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                  tickFormatter={(v) => `T${v}`}
                />
                <YAxis
                  tick={{ fill: "#9ca3af", fontSize: 10 }}
                  tickFormatter={(v) => `${v.toFixed(0)}%`}
                  stroke="#4b5563"
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#020617",
                    borderColor: "#1f2937",
                    color: "#e5e7eb",
                    fontSize: 12,
                  }}
                  labelStyle={{ color: "#9ca3af" }}
                  formatter={(value, name) =>
                    name === "cumReturnPct"
                      ? [`${Number(value).toFixed(2)}%`, "Cumulative return"]
                      : value
                  }
                  labelFormatter={(label, payload) => {
                    const p = payload?.[0]?.payload;
                    return p?.date ? `Trade ${label} (${p.date})` : `Trade ${label}`;
                  }}
                  cursor={{ stroke: "#4b5563", strokeDasharray: "3 3" }}
                />
                <Line
                  type="monotone"
                  dataKey="cumReturnPct"
                  stroke="#22c55e"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Trades table */}
      {!!trades.length && (
        <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/40">
          <div className="mb-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Trades
            </div>
            <div className="text-[11px] text-slate-500">
              Individual backtest trades (entry → expiry).
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full text-[11px] font-mono text-slate-100">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/80 text-[10px] uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-1 text-left">Entry</th>
                  <th className="px-2 py-1 text-left">Expiry</th>
                  <th className="px-2 py-1 text-right">S0</th>
                  <th className="px-2 py-1 text-right">ST</th>
                  <th className="px-2 py-1 text-right">P&amp;L</th>
                  <th className="px-2 py-1 text-right">Return</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((t) => {
                  const pnl = Number(t.pnl);
                  const ret = Number(t.return_pct);
                  const pnlClass =
                    pnl >= 0 ? "text-emerald-300" : "text-rose-300";
                  const retClass =
                    ret >= 0 ? "text-emerald-300" : "text-rose-300";
                  return (
                    <tr
                      key={`${t.entry_date}-${t.expiry_date}`}
                      className="border-t border-slate-900/60 hover:bg-slate-900/70"
                    >
                      <td className="px-2 py-1 text-slate-300">{t.entry_date}</td>
                      <td className="px-2 py-1 text-slate-300">{t.expiry_date}</td>
                      <td className="px-2 py-1 text-right text-slate-200">
                        {formatNumber(t.entry_spot, 2)}
                      </td>
                      <td className="px-2 py-1 text-right text-slate-200">
                        {formatNumber(t.expiry_spot, 2)}
                      </td>
                      <td className={`px-2 py-1 text-right ${pnlClass}`}>
                        {formatMoney(pnl)}
                      </td>
                      <td className={`px-2 py-1 text-right ${retClass}`}>
                        {(ret * 100).toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default Backtester;

