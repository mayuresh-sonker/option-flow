import React, { useMemo } from "react";
import {
  CartesianGrid,
  Label,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

/**
 * IVSmile
 *
 * Props:
 * - chainData: {
 *     calls: Array<{ strike, impliedVolatility }>,
 *     puts:  Array<{ strike, impliedVolatility }>
 *   }
 * - currentPrice: number       // used to find at-the-money strike
 * - histVol30d: number | null  // 30-day historical volatility as decimal (e.g. 0.25)
 */
const IVSmile = ({ chainData, currentPrice, histVol30d = null }) => {
  const { calls = [], puts = [] } = chainData || {};

  // Build average IV per strike across calls/puts
  const smileData = useMemo(() => {
    const map = new Map();

    const addPoint = (strike, iv) => {
      if (typeof strike !== "number" || typeof iv !== "number") return;
      if (Number.isNaN(strike) || Number.isNaN(iv)) return;
      if (!map.has(strike)) {
        map.set(strike, { strike, ivSum: iv, count: 1 });
      } else {
        const row = map.get(strike);
        map.set(strike, {
          strike,
          ivSum: row.ivSum + iv,
          count: row.count + 1,
        });
      }
    };

    calls.forEach((c) =>
      addPoint(c.strike, typeof c.impliedVolatility === "number" ? c.impliedVolatility : NaN)
    );
    puts.forEach((p) =>
      addPoint(p.strike, typeof p.impliedVolatility === "number" ? p.impliedVolatility : NaN)
    );

    const rows = Array.from(map.values()).map((row) => ({
      strike: row.strike,
      iv: row.ivSum / row.count,
    }));

    rows.sort((a, b) => a.strike - b.strike);
    return rows;
  }, [calls, puts]);

  const atmStrike = useMemo(() => {
    if (!smileData.length || typeof currentPrice !== "number") return null;
    let bestStrike = smileData[0].strike;
    let bestDiff = Math.abs(bestStrike - currentPrice);
    for (let i = 1; i < smileData.length; i += 1) {
      const diff = Math.abs(smileData[i].strike - currentPrice);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestStrike = smileData[i].strike;
      }
    }
    return bestStrike;
  }, [smileData, currentPrice]);

  const atmPoint = useMemo(() => {
    if (atmStrike == null) return null;
    return smileData.find((row) => row.strike === atmStrike) || null;
  }, [atmStrike, smileData]);

  const formatPercent = (v) => {
    if (v === null || v === undefined || Number.isNaN(v)) return "—";
    return `${(v * 100).toFixed(1)}%`;
  };

  const histVolPercent = histVol30d != null ? histVol30d * 100 : null;

  return (
    <div className="mt-6 rounded-lg border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-black/40">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Implied Volatility Smile
          </div>
          <div className="text-[11px] text-slate-500">
            IV vs strike for current expiry.
          </div>
        </div>
        {atmPoint && (
          <div className="text-right text-[11px] text-amber-300 font-mono">
            ATM IV: {formatPercent(atmPoint.iv)}
          </div>
        )}
      </div>

      <div className="h-64 w-full drop-shadow-[0_0_18px_rgba(250,204,21,0.25)]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart
            data={smileData}
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
              tickFormatter={(v) => `${v.toFixed(1)}%`}
              tickMargin={4}
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
                name === "iv"
                  ? [formatPercent(value), "Implied Volatility"]
                  : [`${value.toFixed(1)}%`, "30d Hist Vol"]
              }
              labelFormatter={(label) => `Strike: ${label}`}
              cursor={{ stroke: "#4b5563", strokeDasharray: "3 3" }}
            />
            <Legend
              wrapperStyle={{ color: "#9ca3af", fontSize: 11 }}
              iconSize={10}
            />

            {/* Historical 30d volatility reference line */}
            {histVolPercent != null && (
              <ReferenceLine
                y={histVolPercent}
                stroke="#4b5563"
                strokeDasharray="4 4"
              >
                <Label
                  value={`30d Hist Vol ${histVolPercent.toFixed(1)}%`}
                  position="right"
                  fill="#9ca3af"
                  fontSize={10}
                />
              </ReferenceLine>
            )}

            {/* IV Smile line */}
            <Line
              type="monotone"
              dataKey="iv"
              name="Implied Vol"
              stroke="#facc15"
              strokeWidth={2}
              dot={false}
              activeDot={{
                r: 4,
                fill: "#facc15",
                stroke: "#fcd34d",
                strokeWidth: 1.5,
              }}
            />

            {/* ATM highlight point */}
            {atmPoint && (
              <Line
                type="monotone"
                data={[atmPoint]}
                dataKey="iv"
                name="ATM"
                stroke="#22d3ee"
                strokeWidth={0}
                dot={{
                  r: 5,
                  fill: "#22d3ee",
                  stroke: "#0ea5e9",
                  strokeWidth: 2,
                }}
              />
            )}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};

export default IVSmile;

