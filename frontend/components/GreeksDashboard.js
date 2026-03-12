import React, { useEffect, useMemo, useState } from "react";
import axios from "axios";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * GreeksDashboard
 *
 * Props:
 * - ticker: string
 * - expiryYears: number (time to expiry in years, e.g. 0.25)
 * - currentPrice: number (underlying spot price)
 * - optionType: "call" | "put"
 * - chainData: {
 *     calls: Array<{ strike, impliedVolatility }>,
 *     puts:  Array<{ strike, impliedVolatility }>
 *   }
 */
const GreeksDashboard = ({
  ticker,
  expiryYears,
  currentPrice,
  optionType = "call",
  chainData,
}) => {
  const [greeksData, setGreeksData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const backendBaseUrl = "http://localhost:8000";

  const { calls = [], puts = [] } = chainData || {};

  // Build a list of strikes with an IV (prefer call IV, fall back to put IV).
  const strikesWithInputs = useMemo(() => {
    const map = new Map();

    calls.forEach((c) => {
      if (typeof c.strike === "number") {
        map.set(c.strike, {
          strike: c.strike,
          iv: typeof c.impliedVolatility === "number" ? c.impliedVolatility : null,
        });
      }
    });

    puts.forEach((p) => {
      if (typeof p.strike !== "number") return;
      const existing = map.get(p.strike);
      const iv =
        typeof p.impliedVolatility === "number" ? p.impliedVolatility : null;
      if (!existing) {
        map.set(p.strike, { strike: p.strike, iv });
      } else if (existing.iv == null && iv != null) {
        map.set(p.strike, { strike: p.strike, iv });
      }
    });

    const result = Array.from(map.values()).filter(
      (row) => typeof row.iv === "number" && !Number.isNaN(row.iv)
    );

    result.sort((a, b) => a.strike - b.strike);
    return result;
  }, [calls, puts]);

  const atTheMoneyStrike = useMemo(() => {
    if (!strikesWithInputs.length || typeof currentPrice !== "number") {
      return null;
    }
    let bestStrike = strikesWithInputs[0].strike;
    let bestDiff = Math.abs(bestStrike - currentPrice);
    for (let i = 1; i < strikesWithInputs.length; i += 1) {
      const diff = Math.abs(strikesWithInputs[i].strike - currentPrice);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestStrike = strikesWithInputs[i].strike;
      }
    }
    return bestStrike;
  }, [strikesWithInputs, currentPrice]);

  const atmGreeks = useMemo(() => {
    if (!atTheMoneyStrike || !greeksData.length) return null;
    const found = greeksData.find((row) => row.strike === atTheMoneyStrike);
    return found || null;
  }, [atTheMoneyStrike, greeksData]);

  useEffect(() => {
    const fetchAllGreeks = async () => {
      if (
        !ticker ||
        typeof currentPrice !== "number" ||
        typeof expiryYears !== "number" ||
        !Number.isFinite(expiryYears) ||
        expiryYears <= 0 ||
        !strikesWithInputs.length
      ) {
        setGreeksData([]);
        return;
      }

      try {
        setError("");
        setLoading(true);

        const requests = strikesWithInputs.map((row) =>
          axios
            .get(`${backendBaseUrl}/api/greeks`, {
              params: {
                spot: currentPrice,
                strike: row.strike,
                expiry: expiryYears,
                iv: row.iv,
                type: optionType,
              },
            })
            .then((res) => ({
              strike: row.strike,
              delta: res.data?.results?.delta ?? null,
              gamma: res.data?.results?.gamma ?? null,
              theta: res.data?.results?.theta ?? null,
              vega: res.data?.results?.vega ?? null,
            }))
            .catch(() => null)
        );

        const results = await Promise.all(requests);
        const filtered = results.filter(Boolean);
        setGreeksData(filtered);
      } catch (err) {
        console.error(err);
        setError("Unable to fetch Greeks across strikes.");
        setGreeksData([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAllGreeks();
  }, [ticker, currentPrice, expiryYears, optionType, strikesWithInputs]);

  const formatNumber = (value, decimals = 4) => {
    if (value === undefined || value === null || Number.isNaN(value)) {
      return "—";
    }
    return Number(value).toFixed(decimals);
  };

  return (
    <div className="mt-6 space-y-4">
      {/* Cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* Delta */}
        <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70 shadow-lg shadow-black/40">
          <div className="flex items-center justify-between px-3 pt-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Delta
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Price sensitivity to underlying moves.
              </div>
            </div>
            <div className="text-2xl font-semibold text-cyan-300">
              {formatNumber(atmGreeks?.delta, 3)}
            </div>
          </div>
          <div className="px-3 pb-3 pt-2 text-right text-lg italic text-cyan-200 font-serif">
            Δ
          </div>
          <div className="h-1.5 w-full bg-gradient-to-r from-cyan-500 to-cyan-300" />
        </div>

        {/* Gamma */}
        <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70 shadow-lg shadow-black/40">
          <div className="flex items-center justify-between px-3 pt-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Gamma
              </div>
              <div className="mt-1 text-xs text-slate-400">
                How quickly Delta itself changes.
              </div>
            </div>
            <div className="text-2xl font-semibold text-emerald-300">
              {formatNumber(atmGreeks?.gamma, 4)}
            </div>
          </div>
          <div className="px-3 pb-3 pt-2 text-right text-lg italic text-emerald-200 font-serif">
            Γ
          </div>
          <div className="h-1.5 w-full bg-gradient-to-r from-emerald-500 to-emerald-300" />
        </div>

        {/* Theta */}
        <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70 shadow-lg shadow-black/40">
          <div className="flex items-center justify-between px-3 pt-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Theta
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Time decay of the option&apos;s value.
              </div>
            </div>
            <div className="text-2xl font-semibold text-rose-300">
              {formatNumber(atmGreeks?.theta, 3)}
            </div>
          </div>
          <div className="px-3 pb-3 pt-2 text-right text-lg italic text-rose-200 font-serif">
            Θ
          </div>
          <div className="h-1.5 w-full bg-gradient-to-r from-rose-500 to-rose-300" />
        </div>

        {/* Vega */}
        <div className="relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70 shadow-lg shadow-black/40">
          <div className="flex items-center justify-between px-3 pt-3">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                Vega
              </div>
              <div className="mt-1 text-xs text-slate-400">
                Sensitivity to volatility changes.
              </div>
            </div>
            <div className="text-2xl font-semibold text-amber-300">
              {formatNumber(atmGreeks?.vega, 3)}
            </div>
          </div>
          <div className="px-3 pb-3 pt-2 text-right text-lg italic text-amber-200 font-serif">
            ν
          </div>
          <div className="h-1.5 w-full bg-gradient-to-r from-amber-400 to-amber-200" />
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/40">
        <div className="mb-2 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              Greeks vs Strike
            </div>
            <div className="text-[11px] text-slate-500">
              Computed from OptionFlow backend for {ticker || "selected ticker"}.
            </div>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-flex h-3 w-3 animate-spin rounded-full border-[2px] border-emerald-400 border-t-transparent" />
              <span>Updating Greeks…</span>
            </div>
          )}
        </div>

        {error && (
          <div className="mb-3 rounded-md border border-rose-500/60 bg-rose-950/40 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={greeksData}
              margin={{ top: 10, right: 20, bottom: 10, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#1f2937" />
              <XAxis
                dataKey="strike"
                tick={{ fill: "#9ca3af", fontSize: 10 }}
                tickFormatter={(v) => `${v}`}
              />
              <YAxis
                tick={{ fill: "#9ca3af", fontSize: 10 }}
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
                cursor={{ fill: "#020617", opacity: 0.3 }}
              />
              <Legend
                wrapperStyle={{ color: "#9ca3af", fontSize: 11 }}
                iconSize={10}
              />
              <Bar dataKey="delta" fill="#22d3ee" name="Delta" />
              <Bar dataKey="gamma" fill="#22c55e" name="Gamma" />
              <Bar dataKey="theta" fill="#f97373" name="Theta" />
              <Bar dataKey="vega" fill="#eab308" name="Vega" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default GreeksDashboard;

